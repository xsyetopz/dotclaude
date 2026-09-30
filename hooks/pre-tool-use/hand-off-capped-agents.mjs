#!/usr/bin/env bun
// PreToolUse(SendMessage): an agent that stopped at its turn limit is not
// resumed. Its context has grown with every turn and each further turn
// re-reads all of it, while a fresh agent briefed from a report starts small.
// Claude Code delivers no report from an agent cut off at its limit, so the
// first message to it is rewritten into a request for a handoff report; any
// later message is denied, pointing at a fresh agent instead.

import fs from "node:fs";
import path from "node:path";
import {
  emit,
  option,
  preToolDecision,
  run,
  stateDir,
} from "../lib/_common.mjs";

const REPORT_REQUEST =
  "You stopped at your turn limit, and a fresh agent will continue this work. Make no more tool calls. Reply now with your final report as a handoff. Include the goal, what you did, and how you verified it (commands and results). Include the files you changed and anything you left half-edited or uncommitted. Include the work that remains, in order, and anything the next agent must know.";

/** True when the transcript shows agent `id` stopping at its turn limit. */
function stoppedAtLimit(transcript, id) {
  let text;
  try {
    text = fs.readFileSync(transcript, "utf8");
  } catch {
    return false;
  }
  const tag = `<task-id>${id}</task-id>`;
  let at = text.indexOf(tag);
  while (at !== -1) {
    const end = text.indexOf("</task-notification>", at);
    const note = text.slice(at, end === -1 ? at + 4000 : end);
    if (/stopped at its \d+-turn limit/.test(note)) return true;
    at = text.indexOf(tag, at + tag.length);
  }
  return false;
}

function statePath(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(stateDir(), `${safe}.capped-agents.json`);
}

function readState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

run((data) => {
  if (!option("turn_limit_handoff")) return;
  const input = data.tool_input ?? {};
  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(to)) return;
  const file = statePath(data.session_id);
  const reported = readState(file);
  if (reported.includes(to)) {
    preToolDecision(
      "deny",
      `Agent \`${to}\` stopped at its turn limit, and dotclaude already asked it for its handoff report. Resuming it re-reads its whole context on every turn. Start a fresh agent of the same type instead, briefed from that report (goal, what is done, the files, what remains). If the report never arrived, read the agent's output file named in its task notification.`,
    );
    return;
  }
  if (!stoppedAtLimit(data.transcript_path ?? "", to)) return;
  fs.writeFileSync(file, JSON.stringify([...reported, to]));
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason:
        "The agent stopped at its turn limit, so this message asks only for its handoff report.",
      updatedInput: { ...input, message: REPORT_REQUEST },
      additionalContext: `This hook replaced the message to \`${to}\` with a request for its handoff report, because it stopped at its turn limit. When the report arrives, continue the work with a fresh agent of the same type, briefed from it. This hook blocks further messages to \`${to}\`.`,
    },
  });
});
