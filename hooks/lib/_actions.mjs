// The action table of the hooks and the merge of the action outputs. The
// command dispatcher (`dispatch.mjs`) and the hooks module (`register.mjs`)
// both use them, so this file has no Node, no Bun, and no `$`.

export const TOOL_EDITS = "Edit|Write|MultiEdit|NotebookEdit";

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
    ["resume|fork", "session-start/warn-cold-cache-resume.mjs"],
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
    [`Bash|${TOOL_EDITS}`, "post-tool-use/record-edits-and-checks.mjs"],
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

// Actions with their own hooks.json command, outside the dispatcher table.
// Claude Code keeps at most about 10,000 bytes of the output of one command
// in the context, so the working rules do not share the merged output of
// their event (docs/dossier/prompt-surface.md).
export const OWN_COMMANDS = {
  SessionStart: [
    ["startup|clear|compact", "session-start/add-working-rules.mjs"],
  ],
};

// The events that the hooks module (`register.mjs`) runs. `hooks.json` has
// no command hook for them, so each action runs once.
export const MODULE_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
  "UserPromptSubmit",
  "PreCompact",
];

export const MATCH_FIELD = {
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
