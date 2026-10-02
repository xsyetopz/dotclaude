#!/usr/bin/env bun
// One process per hook event: `bun dispatch.mjs <Event>` imports the actions
// of that event, runs each one whose matcher fits the input, and merges their
// outputs into one reply. One process instead of one per action halves the
// CPU time of the hooks on a `Bash` call (docs/dossier/design.md).
//
// `bun dispatch.mjs --only <event-dir>/<action>.mjs ...` runs the named
// actions with no matcher, as the tests do.
//
// The actions of one event run at the same time, so an action that waits
// for a child process (`redact-secrets` waits about 25 ms for Betterleaks) does
// not delay the others. The merge uses the table order, not the finish order.
//
// Each action fails open on its own: an error in one action is logged to
// stderr and the others still run.

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { readInput, TAG } from "./lib/_common.mjs";

const TOOL_EDITS = "Edit|Write|MultiEdit|NotebookEdit";

// Event -> [matcher, action] in run order. `*` matches every input. A
// matcher applies to the input field in MATCH_FIELD.
export const ACTIONS = {
  SessionStart: [
    ["compact", "session-start/restore-context-after-compact.mjs"],
    ["startup|resume", "session-start/warn-incomplete-setup.mjs"],
    ["startup|resume", "session-start/prune-scratchpads.mjs"],
    ["startup|resume", "session-start/refresh-ai-policies.mjs"],
    ["startup|resume", "session-start/warn-instruction-size.mjs"],
    ["startup|clear", "session-start/point-to-handoff.mjs"],
    ["*", "session-start/add-session-notes.mjs"],
  ],
  UserPromptSubmit: [["*", "user-prompt-submit/note-usage-limits.mjs"]],
  SubagentStart: [
    ["*", "subagent-start/inject-working-conventions.mjs"],
    ["*", "subagent-start/count-running-agents.mjs"],
  ],
  PreToolUse: [
    ["Bash", "pre-tool-use/block-destructive-commands.mjs"],
    ["Bash|Read", "pre-tool-use/skip-unchanged-rereads.mjs"],
    [TOOL_EDITS, "pre-tool-use/confirm-risky-edits.mjs"],
    ["Agent", "pre-tool-use/restrict-subagent-models.mjs"],
    ["Agent", "pre-tool-use/prefer-dotclaude-agents.mjs"],
    ["SendMessage", "pre-tool-use/hand-off-capped-agents.mjs"],
    ["*", "pre-tool-use/enforce-agent-budget.mjs"],
  ],
  PostToolUse: [
    [`Bash|Read|${TOOL_EDITS}`, "post-tool-use/record-edits-and-checks.mjs"],
    ["Bash", "post-tool-use/load-nested-instructions.mjs"],
    [`EnterWorktree|${TOOL_EDITS}`, "post-tool-use/exclude-session-files.mjs"],
    ["*", "post-tool-use/redact-secrets.mjs"],
    ["*", "post-tool-use/note-context-size.mjs"],
  ],
  PostToolUseFailure: [
    [`Bash|${TOOL_EDITS}`, "post-tool-use-failure/record-failed-checks.mjs"],
    ["Edit", "post-tool-use-failure/show-closest-lines.mjs"],
  ],
  Stop: [
    ["*", "stop/require-verification.mjs"],
    ["*", "stop/end-goal-loops.mjs"],
    ["*", "stop/check-open-tasks.mjs"],
    ["*", "stop/check-loop-reviews.mjs"],
    ["*", "stop/finish-announced-work.mjs"],
  ],
  StopFailure: [["rate_limit", "stop-failure/notify-rate-limit.mjs"]],
  SubagentStop: [
    ["*", "stop/require-verification.mjs"],
    ["*", "stop/count-running-agents.mjs"],
  ],
  PreCompact: [["*", "pre-compact/save-recent-prompts.mjs"]],
  PreModelSwitch: [["*", "pre-model-switch/restrict-models.mjs"]],
  PostModelSwitch: [["*", "post-model-switch/add-model-notes.mjs"]],
  ConfigChange: [
    [
      "user_settings|project_settings|local_settings",
      "config-change/block-fast-mode.mjs",
    ],
  ],
  TaskCompleted: [["*", "task-completed/require-check.mjs"]],
};

const MATCH_FIELD = {
  PreToolUse: "tool_name",
  PostToolUse: "tool_name",
  PostToolUseFailure: "tool_name",
  SessionStart: "source",
  StopFailure: "error",
  ConfigChange: "source",
};

export function matches(matcher, value) {
  if (matcher === "*") return true;
  return new RegExp(`^(?:${matcher})$`).test(String(value ?? ""));
}

const RANK = { deny: 3, ask: 2, allow: 1 };

function joined(values, sep) {
  const list = values.filter((v) => typeof v === "string" && v);
  return list.length ? list.join(sep) : undefined;
}

/** Merge the JSON outputs of several actions of one event into one. */
export function merge(outputs) {
  if (outputs.length <= 1) return outputs[0];
  const out = {};
  const first = (key, list = outputs) => {
    const hit = list.find((o) => o[key] !== undefined);
    return hit?.[key];
  };
  if (outputs.some((o) => o.continue === false)) {
    out.continue = false;
    out.stopReason = first(
      "stopReason",
      outputs.filter((o) => o.continue === false),
    );
  }
  if (outputs.some((o) => o.suppressOutput)) out.suppressOutput = true;
  out.systemMessage = joined(
    outputs.map((o) => o.systemMessage),
    "\n",
  );
  // Claude gets every block reason. Each blocking action has already saved
  // its once-per-session state, so a reason that is dropped here never shows.
  const blocks = outputs.filter((o) => o.decision === "block");
  if (blocks.length) {
    out.decision = "block";
    out.reason = joined(
      blocks.map((o) => o.reason),
      "\n\n",
    );
  }
  const specific = outputs.map((o) => o.hookSpecificOutput).filter(Boolean);
  if (specific.length) {
    const h = { hookEventName: specific[0].hookEventName };
    // Deny beats ask beats allow. The reason and any rewritten input come
    // from the first output with the winning decision.
    const decided = specific.filter((s) => RANK[s.permissionDecision]);
    if (decided.length) {
      const top = Math.max(...decided.map((s) => RANK[s.permissionDecision]));
      const win = decided.find((s) => RANK[s.permissionDecision] === top);
      h.permissionDecision = win.permissionDecision;
      h.permissionDecisionReason = win.permissionDecisionReason;
      if (win.updatedInput) h.updatedInput = win.updatedInput;
    }
    h.additionalContext = joined(
      specific.map((s) => s.additionalContext),
      "\n\n",
    );
    for (const s of specific)
      for (const [key, value] of Object.entries(s))
        if (
          !(key in h) &&
          ![
            "permissionDecision",
            "permissionDecisionReason",
            "updatedInput",
          ].includes(key)
        )
          h[key] = value;
    out.hookSpecificOutput = h;
  }
  for (const o of outputs)
    for (const [key, value] of Object.entries(o))
      if (!(key in out)) out[key] = value;
  return JSON.parse(JSON.stringify(out));
}

function select(argv, data) {
  if (argv[0] === "--only") return argv.slice(1);
  const event = argv[0] ?? data.hook_event_name;
  const field = MATCH_FIELD[event];
  return (ACTIONS[event] ?? [])
    .filter(([matcher]) => matches(matcher, field ? data[field] : undefined))
    .map(([, action]) => action);
}

/** Values of `[index, value]` pairs, in index order. */
const ordered = (pairs) =>
  pairs.toSorted(([a], [b]) => a - b).map(([, value]) => value);

async function main() {
  const data = readInput();
  const current = new AsyncLocalStorage();
  const mode = {
    bodies: [],
    outputs: [],
    blocking: [],
    action: () => current.getStore(),
  };
  globalThis[Symbol.for("dotclaude.dispatch")] = mode;
  const fail = (action, err) => {
    if (process.env.DOTCLAUDE_DEBUG) throw err;
    process.stderr.write(
      `${TAG} hook error in ${action} (ignored): ${err?.stack ?? err}\n`,
    );
  };
  const runs = [];
  for (const [index, action] of select(process.argv.slice(2), data).entries()) {
    const count = mode.bodies.length;
    try {
      await import(path.join(import.meta.dirname, action));
    } catch (err) {
      fail(action, err);
      continue;
    }
    // Each action module registers one body when it is imported.
    if (mode.bodies.length === count) continue;
    const body = mode.bodies.at(-1);
    runs.push(
      current
        .run(index, async () => body(structuredClone(data)))
        .catch((err) => fail(action, err)),
    );
  }
  await Promise.all(runs);
  if (mode.blocking.length) {
    fs.writeSync(2, `${ordered(mode.blocking).join("\n")}\n`);
    process.exit(2);
  }
  const out = merge(ordered(mode.outputs));
  if (out) process.stdout.write(JSON.stringify(out));
  process.exitCode = 0;
}

if (import.meta.main) await main();
