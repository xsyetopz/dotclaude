// Shared helpers for dotclaude hooks.
//
// Every hook fails open: a bug or an unexpected input shape must never block
// the user's work, so entry points wrap their body in `run()`.

import fs from "node:fs";
import { preToolOutput, TAG, tagOutput, verdict } from "./_core.mjs";

export function readInput() {
  try {
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
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
  const out = tagOutput(obj);
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
  const subagent = data.hook_event_name === "SubagentStop";
  // `claude -p` and the Agent SDK return only the last message, and so does a
  // subagent. A short reply to this note would replace the report.
  const lastOnly =
    subagent || /^sdk-/.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? "");
  emit({
    hookSpecificOutput: {
      hookEventName: subagent ? "SubagentStop" : "Stop",
      additionalContext: lastOnly
        ? `${text} The caller gets only your last message, so make that message the full report, without the part that this note is about.`
        : text,
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
  emit(preToolOutput(decision, reason));
}

/**
 * Turn guard findings into one PreToolUse decision with `verdict`. `label`
 * names what was checked ("command", "edit").
 */
export function decide(findings, data, label) {
  const v = verdict(findings, data, label, process.env);
  if (v) preToolDecision(...v);
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
