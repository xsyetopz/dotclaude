// Shared helpers for dotclaude hooks.
//
// Every hook fails open: a bug or an unexpected input shape must never block
// the user's work, so entry points wrap their body in `run()`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FALSE = new Set(["0", "false", "no", "off", ""]);

export function readInput() {
  try {
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** Boolean userConfig option, exported to hooks as CLAUDE_PLUGIN_OPTION_<KEY>. */
export function option(key, fallback = true) {
  const raw = process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
  if (raw === undefined) return fallback;
  return !FALSE.has(raw.trim().toLowerCase());
}

export function optionList(key, fallback) {
  let raw = process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
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

export function stateDir() {
  const base =
    process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "dotclaude");
  const dir = path.join(base, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Claude Code deletes session transcripts after `cleanupPeriodDays`, 30 by
// default, and dotclaude's per-session state is useless without them.
const STATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Delete state files not modified in 30 days; returns how many went. */
export function pruneState(now = Date.now()) {
  const dir = stateDir();
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      if (stat.isFile() && now - stat.mtimeMs > STATE_MAX_AGE_MS) {
        fs.rmSync(file);
        removed += 1;
      }
    } catch {
      // Another session removed or replaced it first.
    }
  }
  return removed;
}

export function projectRoot(data) {
  return path.resolve(
    process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd(),
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

// `hooks/dispatch.mjs` runs several actions in one process. It sets this
// before it imports the actions: `run` then registers each body, and `emit`
// and `exitBlocking` record their output, with the index of the action that
// runs now (`mode.action()`), for the dispatcher to merge in action order.
const DISPATCH = Symbol.for("dotclaude.dispatch");

export function dispatchMode() {
  return globalThis[DISPATCH];
}

export function emit(obj) {
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
  const mode = dispatchMode();
  if (mode) mode.outputs.push([mode.action(), out]);
  else process.stdout.write(JSON.stringify(out));
}

/**
 * Send Claude back to work before the turn ends. Claude Code shows
 * `additionalContext` to the user as "Stop hook feedback". A
 * `decision: "block"` reason shows as "Stop hook error".
 */
export function stopFeedback(data, text) {
  emit({
    hookSpecificOutput: {
      hookEventName:
        data.hook_event_name === "SubagentStop" ? "SubagentStop" : "Stop",
      additionalContext: text,
    },
  });
}

/**
 * Block with exit code 2: Claude Code gives `message` to Claude and ignores
 * stdout. Under the dispatcher the exit waits until every action has run.
 */
export function exitBlocking(message) {
  const mode = dispatchMode();
  if (mode) {
    mode.blocking.push([mode.action(), message]);
    return;
  }
  fs.writeSync(2, message.endsWith("\n") ? message : `${message}\n`);
  process.exit(2);
}

export function preToolDecision(decision, reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  });
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
 * Turn guard findings into one PreToolUse decision. `label` names what was
 * checked ("command", "edit"). Deny wins; then ask; "warn" asks only when the
 * session is in an attended permission mode or `ask_in_auto_mode` is on.
 */
export function decide(findings, data, label) {
  const v = verdict(findings, data, label);
  if (v) preToolDecision(...v);
}

/** The decision `decide` emits, as [decision, reason], or null for none. */
export function verdict(findings, data, label) {
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
    UNATTENDED.has(data.permission_mode) && !option("ask_in_auto_mode", false);
  const asks = findings.filter(
    ([level]) => level === "ask" || (level === "warn" && !quiet),
  );
  return asks.length ? ["ask", sentences(asks)] : null;
}

export async function run(body) {
  const mode = dispatchMode();
  if (mode) {
    mode.bodies.push(body);
    return;
  }
  try {
    await body(readInput());
  } catch (err) {
    if (process.env.DOTCLAUDE_DEBUG) throw err;
    process.stderr.write(`${TAG} hook error (ignored): ${err?.stack ?? err}\n`);
  }
  process.exitCode = 0;
}
