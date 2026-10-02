// Pure shared helpers for dotclaude hooks. The guard closure imports this
// file, so it reaches the host only through `io` (`_io.mjs`) or an `env`
// object. The process-bound part (`readInput`, `emit`, `run`) is in
// `_common.mjs`.

import { pathFor } from "./_path.mjs";

const FALSE = new Set(["0", "false", "no", "off", ""]);

/** Boolean userConfig option, exported to hooks as CLAUDE_PLUGIN_OPTION_<KEY>. */
export function option(env, key, fallback = true) {
  const raw = env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
  if (raw === undefined) return fallback;
  return !FALSE.has(raw.trim().toLowerCase());
}

export function optionList(env, key, fallback) {
  let raw = env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
  if (!raw?.trim()) raw = fallback;
  if (raw.trim().startsWith("[")) {
    try {
      return JSON.parse(raw)
        .map((item) => String(item).trim())
        .filter(Boolean);
    } catch {
      // fall through to comma splitting
    }
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * The folder of the per-session state files. This function creates no
 * folder. `io.fs.write`, `append`, and `create` create it.
 */
export function stateDir(io) {
  const path = pathFor(io.platform);
  const base = io.env.CLAUDE_PLUGIN_DATA || path.join(io.tmp, "dotclaude");
  return path.join(base, "sessions");
}

// Claude Code deletes session transcripts after `cleanupPeriodDays`, 30 by
// default, and dotclaude's per-session state is useless without them.
const STATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Delete state files not modified in 30 days. Returns how many went. */
export async function pruneState(io, now = Date.now()) {
  const path = pathFor(io.platform);
  const dir = stateDir(io);
  let entries;
  try {
    entries = await io.fs.list(dir);
  } catch {
    // No folder, so no state to remove.
    return 0;
  }
  let removed = 0;
  for (const { name } of entries) {
    const file = path.join(dir, name);
    try {
      const stat = await io.fs.stat(file);
      if (stat.kind === "file" && now - stat.mtimeMs > STATE_MAX_AGE_MS) {
        await io.fs.remove(file);
        removed += 1;
      }
    } catch {
      // Another session removed or replaced it first.
    }
  }
  return removed;
}

export function projectRoot(io, data) {
  return pathFor(io.platform).resolve(
    io.cwd,
    io.env.CLAUDE_PROJECT_DIR || data.cwd || io.cwd,
  );
}

// Prompts Claude Code generates itself (background-task notifications,
// subagent hand-backs) rather than ones the user typed.
const GENERATED =
  /^\s*(<task-notification>|<agent-message\b|\[SYSTEM NOTIFICATION|Another Claude session sent a message:)|<task-notification>[\s\S]*<\/task-notification>\s*$/;

export function userTyped(prompt) {
  return (
    typeof prompt === "string" &&
    prompt.trim() !== "" &&
    !GENERATED.test(prompt)
  );
}

// Every message dotclaude shows Claude or the user starts with this tag, so
// its origin is never in doubt.
export const TAG = "[dotclaude]";

function tagged(text) {
  return typeof text === "string" && text && !text.startsWith(TAG)
    ? `${TAG} ${text}`
    : text;
}

/** A copy of a hook output object with the tag on each text for Claude. */
export function tagOutput(obj) {
  const out = { ...obj };
  for (const key of ["reason", "systemMessage", "stopReason"])
    if (key in out) out[key] = tagged(out[key]);
  if (out.hookSpecificOutput) {
    const h = { ...out.hookSpecificOutput };
    // Only a "deny" reason goes to Claude. Claude Code shows an "ask" or
    // "allow" reason to the user and labels it as a hook's, so it gets no tag.
    const keys = ["additionalContext"];
    if (h.permissionDecision === "deny") keys.push("permissionDecisionReason");
    for (const key of keys) if (key in h) h[key] = tagged(h[key]);
    out.hookSpecificOutput = h;
  }
  return out;
}

/** The PreToolUse output object for one permission decision. */
export function preToolOutput(decision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

// Modes where nobody is watching for a prompt: an "ask" there stalls the
// session (or is auto-denied), so recoverable "warn" findings stay silent and
// the mode's own classifier or rules decide.
const UNATTENDED = new Set(["auto", "dontAsk", "bypassPermissions"]);

/** Findings' reasons as sentences: each starts with a capital and ends with a period. */
function sentences(findings) {
  return findings
    .map(([, reason]) => {
      const s = reason.charAt(0).toUpperCase() + reason.slice(1);
      return /[.!?]$/.test(s) ? s : `${s}.`;
    })
    .join(" ");
}

/**
 * Turn guard findings into one PreToolUse decision, as [decision, reason], or
 * null for none. `label` names what was checked ("command", "edit"). Deny
 * wins, then ask. "warn" asks only when the session is in an attended
 * permission mode or the `guard_ask_in_auto` option in `env` is on.
 */
export function verdict(findings, data, label, env) {
  const denied = findings.filter(([level]) => level === "deny");
  if (denied.length)
    return [
      "deny",
      `blocked this ${label}. ${sentences(denied)}${
        label === "command"
          ? " If the user wants this command to run, tell them to run it themselves with `! <command>`."
          : ""
      }`,
    ];
  const quiet =
    UNATTENDED.has(data.permission_mode) &&
    !option(env, "guard_ask_in_auto", false);
  const asks = findings.filter(
    ([level]) => level === "ask" || (level === "warn" && !quiet),
  );
  return asks.length ? ["ask", sentences(asks)] : null;
}
