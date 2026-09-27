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

export function emit(obj) {
  const out = { ...obj };
  for (const key of ["reason", "systemMessage", "stopReason"])
    if (key in out) out[key] = tagged(out[key]);
  if (out.hookSpecificOutput) {
    const h = { ...out.hookSpecificOutput };
    for (const key of ["permissionDecisionReason", "additionalContext"])
      if (key in h) h[key] = tagged(h[key]);
    out.hookSpecificOutput = h;
  }
  process.stdout.write(JSON.stringify(out));
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

/**
 * Turn guard findings into one PreToolUse decision. `label` names what was
 * checked ("command", "edit"). Deny wins; then ask; "warn" asks only when the
 * session is in an attended permission mode or `ask_in_auto_mode` is on.
 */
export function decide(findings, data, label) {
  const denied = findings.filter(([level]) => level === "deny");
  if (denied.length) {
    preToolDecision(
      "deny",
      `blocked this ${label}: ${denied.map(([, r]) => r).join("; ")}.${
        label === "command"
          ? " If the user wants it run, they can run it themselves with `! <command>`."
          : ""
      }`,
    );
    return;
  }
  const quiet =
    UNATTENDED.has(data.permission_mode) && !option("ask_in_auto_mode", false);
  const asks = findings.filter(
    ([level]) => level === "ask" || (level === "warn" && !quiet),
  );
  if (asks.length)
    preToolDecision("ask", asks.map(([, reason]) => reason).join("; "));
}

export async function run(body) {
  try {
    await body(readInput());
  } catch (err) {
    if (process.env.DOTCLAUDE_DEBUG) throw err;
    process.stderr.write(`${TAG} hook error (ignored): ${err?.stack ?? err}\n`);
  }
  process.exitCode = 0;
}
