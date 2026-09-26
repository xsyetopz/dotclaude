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

export function projectRoot(data) {
  return path.resolve(
    process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd(),
  );
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
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
      `dotclaude blocked this ${label}: ${denied.map(([, r]) => r).join("; ")}.${
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
    preToolDecision(
      "ask",
      `dotclaude: ${asks.map(([, reason]) => reason).join("; ")}`,
    );
}

export async function run(body) {
  try {
    await body(readInput());
  } catch (err) {
    if (process.env.DOTCLAUDE_DEBUG) throw err;
    process.stderr.write(
      `dotclaude hook error (ignored): ${err?.stack ?? err}\n`,
    );
  }
  process.exitCode = 0;
}
