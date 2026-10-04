// The hooks module of dotclaude. It runs in Claude Code with no Node and no
// Bun, and reaches the host only through the engine's `$`.
//
// `claude plugin validate` follows `$` only into a function of this file and
// refuses `$` as a value. Thus each function that touches `$` is here, and
// each `$.env.get` call has its name as a literal. The rules are pure
// functions in `lib/`.

import {
  parseDefinition,
  pinnedModel,
  spawnDenial,
} from "./lib/_agent-rules.mjs";
import { askFor } from "./lib/_bash-rules.mjs";
import {
  HANDOFF_FORK_TIMEOUT_MS,
  SECRET_SCAN_MAX_BYTES,
  SECRET_SCAN_TIMEOUT_MS,
} from "./lib/_budget.mjs";
import { idleNote } from "./lib/_cache.mjs";
import {
  COMPACT_TEXT,
  HANDOFF_PROMPT,
  handoffFile,
  handoffPath,
  handoffRow,
} from "./lib/_compact.mjs";
import { editReasons } from "./lib/_edit-rules.mjs";
import {
  accountFrom,
  cacheTtlMs,
  claudeJsonPath,
  detectPlan,
} from "./lib/_plan.mjs";
import {
  findingsOf,
  redact,
  redactionNote,
  SCAN_ARGS,
  strings,
} from "./lib/_secrets.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

let plan;
/** The plan of the user, read once for each session. */
async function sessionPlan($) {
  if (plan) return plan;
  // Each name is a literal, so that `claude plugin validate` lists it.
  const [HOME, CLAUDE_CONFIG_DIR, ANTHROPIC_API_KEY, BEDROCK, VERTEX, FOUNDRY] =
    await Promise.all([
      $.env.get("HOME"),
      $.env.get("CLAUDE_CONFIG_DIR"),
      $.env.get("ANTHROPIC_API_KEY"),
      $.env.get("CLAUDE_CODE_USE_BEDROCK"),
      $.env.get("CLAUDE_CODE_USE_VERTEX"),
      $.env.get("CLAUDE_CODE_USE_FOUNDRY"),
    ]);
  const env = {
    HOME,
    CLAUDE_CONFIG_DIR,
    ANTHROPIC_API_KEY,
    CLAUDE_CODE_USE_BEDROCK: BEDROCK,
    CLAUDE_CODE_USE_VERTEX: VERTEX,
    CLAUDE_CODE_USE_FOUNDRY: FOUNDRY,
  };
  const text = await $.fs.read(claudeJsonPath(env)).catch(() => "");
  plan = detectPlan(env, accountFrom(text));
  return plan;
}

/** A plugin option is on unless the user turned it off. */
const enabled = (options, name) =>
  options?.[name] !== false && options?.[name] !== "false";

/** The reason to ask about a tool call, or undefined. */
async function askReason($, e, options) {
  if (e.tool === "Bash" && enabled(options, "guard_bash")) {
    const [cwd, project, home] = await Promise.all([
      $.session.cwd().catch(() => ""),
      $.session.root().catch(() => ""),
      $.env.get("HOME"),
    ]);
    const found = askFor(String(e.command ?? ""), {
      cwd: cwd || project,
      project,
      home,
    });
    return found.length
      ? found.map((f) => `\`${f.part}\`: ${f.reason}`).join(" ")
      : undefined;
  }
  if (EDIT_TOOLS.has(e.tool) && enabled(options, "guard_edit")) {
    const existing =
      e.tool === "Write" && e.file_path
        ? await $.fs.read(e.file_path).catch(() => null)
        : null;
    return editReasons(e.tool, e, existing).join(" ") || undefined;
  }
  return undefined;
}

/**
 * The secrets that Betterleaks finds in `text`, or null when it is missing,
 * fails, or gives a report that is not valid.
 */
async function scan($, text) {
  if (!text) return null;
  const tmp = (await $.env.get("TMPDIR")) || "/tmp";
  try {
    const result = await $.process.run(SCAN_ARGS, {
      cwd: tmp,
      stdin: text,
      timeoutMs: SECRET_SCAN_TIMEOUT_MS,
    });
    if (result.exitCode !== 0 || result.isStdoutTruncated) return null;
    if (result.stdout.length > SECRET_SCAN_MAX_BYTES) return null;
    return findingsOf(result.stdout);
  } catch {
    // Betterleaks is missing, or it passed the timeout.
    return null;
  }
}

/** The agent file of a `dotclaude:` agent, parsed, or undefined. */
async function agentDefinition($, subagentType) {
  const name = /^dotclaude:([a-z0-9-]+)$/.exec(String(subagentType))?.[1];
  if (!name) return undefined;
  const text = await $.fs.read(`${$.plugin.root}/agents/${name}.md`);
  return parseDefinition(text);
}

/**
 * The handoff note of the main conversation, from a fork that sees the whole
 * conversation. It saves the note under `.claude/handoffs/` and gives
 * `{ text, path }`, or null when the fork fails, times out, or gives no text.
 */
async function forkHandoff($) {
  let timer;
  try {
    const late = new Promise((resolve) => {
      timer = setTimeout(resolve, HANDOFF_FORK_TIMEOUT_MS);
    });
    const fork = await Promise.race([
      $.model.fork({ prompt: HANDOFF_PROMPT }),
      late,
    ]);
    if (!fork?.isAnswered || !fork.text?.trim()) return null;
    const at = new Date();
    const path = handoffPath(await $.session.root(), at);
    // The note is in memory, so a failed write loses only the file.
    await $.fs.write(path, handoffFile(fork.text, at)).catch(() => {});
    return { text: fork.text, path };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Register the guards. A tool call that needs approval stays in `asks` until
 * the call ends, because `tool.check` runs inside the `next` of `tool.call`.
 * Each guard fails open: a throw gives no verdict, and a throw in the module
 * would make the engine skip all of dotclaude for the event.
 */
export function register(on, options) {
  const asks = new Map();

  on("tool.call", async ($, e, next) => {
    const id = e.tool_use_id;
    let reason;
    try {
      reason = await askReason($, e, options);
    } catch {
      reason = undefined;
    }
    const keep = reason !== undefined && id !== undefined;
    if (keep) asks.set(id, { decision: "ask", reason });
    let r;
    try {
      r = await next(e);
    } finally {
      if (keep) asks.delete(id);
    }
    if (!r || "deny" in r || r.isError || !enabled(options, "guard_secrets"))
      return r;
    const findings = await scan($, strings(r.result).join("\n"));
    if (!findings?.length) return r;
    const { value, count } = redact(r.result, findings);
    if (!count) return r;
    // Core uses its own messages (`ref`, `text`) when they stay, so a
    // changed result is a new object without them.
    return {
      result: value,
      context: [...(r.context ?? []), redactionNote(count, findings)],
    };
  });

  // The model and effort rules. The call keeps its `model`: a model that the
  // agent file does not fix is a denial with the reason, not a silent change.
  on("agent.spawn", async ($, e, next) => {
    if (!enabled(options, "guard_agents")) return next(e);
    let def;
    try {
      def = await agentDefinition($, e.subagentType);
    } catch {
      def = undefined;
    }
    const deny = spawnDenial({
      askedModel: e.fork ? undefined : e.model,
      parentModel: e.parentModel,
      pinned: pinnedModel(def),
      effort: e.effort ?? def?.effort,
    });
    return deny ? { deny } : next(e);
  });

  // The cold-cache note goes down with the prompt. Only a prompt between
  // turns gets it, because a prompt in a turn follows a recent response.
  on("prompt.submit", async ($, e, next) => {
    const last = Number(await $.store.get("last-turn-ms").catch(() => 0));
    const idle = Date.now() - last;
    if (
      e.turnId !== undefined ||
      !last ||
      idle <= cacheTtlMs(await sessionPlan($))
    )
      return next(e);
    return next({ ...e, context: [...(e.context ?? []), idleNote(idle)] });
  });

  on("turn.complete", async ($, e, next) => {
    if (!e.agentId)
      await $.store.set("last-turn-ms", Date.now()).catch(() => {});
    return next(e);
  });

  // The summary instruction, and a handoff note from a fork that runs before
  // `next`, so it sees the whole conversation. A `precompute` installs
  // nothing, and a subagent gets no note. The compaction always continues.
  on("session.compact", async ($, e, next) => {
    if (e.trigger === "precompute") return next(e);
    const handoff =
      !e.agentId && enabled(options, "compaction_handoff")
        ? await forkHandoff($)
        : null;
    const r = await next({
      ...e,
      instructions: [e.instructions, COMPACT_TEXT].filter(Boolean).join("\n\n"),
    });
    return handoff && r?.messages
      ? {
          ...r,
          messages: [...r.messages, handoffRow(handoff.text, handoff.path)],
        }
      : r;
  });

  // The engine's "deny" stays, so a rule of the user is not weakened.
  on("tool.check", async (_$, e, next) => {
    const verdict = await next(e);
    const kept = asks.get(e.tool_use_id);
    return kept && verdict?.decision !== "deny" ? kept : verdict;
  });
}
