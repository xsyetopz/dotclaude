// The hooks module of dotclaude. It runs in Claude Code with no Node and no
// Bun, and reaches the host only through the engine's `$`.
//
// `claude plugin validate` follows `$` only into a function of this file and
// refuses `$` as a value. Thus each function that touches `$` is here, and
// each `$.env.get` call has its name as a literal. The rules are pure
// functions in `lib/`.

import { askFor } from "./lib/_bash-rules.mjs";
import {
  SECRET_SCAN_MAX_BYTES,
  SECRET_SCAN_TIMEOUT_MS,
} from "./lib/_budget.mjs";
import { editReasons } from "./lib/_edit-rules.mjs";
import {
  findingsOf,
  redact,
  redactionNote,
  SCAN_ARGS,
  strings,
} from "./lib/_secrets.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

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

  // The engine's "deny" stays, so a rule of the user is not weakened.
  on("tool.check", async (_$, e, next) => {
    const verdict = await next(e);
    const kept = asks.get(e.tool_use_id);
    return kept && verdict?.decision !== "deny" ? kept : verdict;
  });
}
