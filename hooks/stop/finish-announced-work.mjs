#!/usr/bin/env bun
// Stop hook: send Claude back once when the last paragraph of its reply
// announces the next step ("Next I'll ...") or asks permission for work
// ("Should I ...?", "Want me to ...?") instead of doing it. In the audited
// sessions, 54 of 439 user messages only answered such an ending.
//
// It passes on the second stop of a turn, after an `AskUserQuestion` call,
// and when the paragraph names a public or hard-to-reverse step, because
// those wait for the user.

import { emit, option, run } from "../lib/_common.mjs";
import { tail } from "../lib/_transcript.mjs";
import { logVerdict } from "../lib/_verdicts.mjs";

const ANNOUNCES = [
  /\b(?:next|now|then),? I(?:'ll| will)\b/i,
  /\bI(?:'ll| will) (?:now|next)\b/i,
  /(?:^|[.!?]\s+)(?:should|shall) I\b/i,
  /\b(?:do you )?want me to\b/i,
  /\bwould you like me to\b/i,
  /\bI can\b[^.?!]*\bif you(?:'d)? (?:want|like)\b/i,
  /\blet me know if you(?:'d like| want)\b/i,
  /\bstill unapplied\b|\bnot applied yet\b/i,
];

// Steps that wait for the user: other people see them, or they are hard to
// reverse.
const WAITS =
  /\b(?:push|publish|release|deploy|tag|merge|delete|drop|force|rebase|reset --hard|send|post)\w*\b/i;

function lastParagraph(message) {
  const parts = message
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.at(-1) ?? "";
}

/** True when the last assistant entry of the transcript calls AskUserQuestion. */
function askedUser(transcriptPath) {
  const text = transcriptPath ? tail(transcriptPath, 500_000) : null;
  if (!text) return false;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.type !== "assistant" || entry.isSidechain) continue;
    const content = entry.message?.content;
    return (
      Array.isArray(content) &&
      content.some((c) => c.type === "tool_use" && c.name === "AskUserQuestion")
    );
  }
  return false;
}

run((data) => {
  if (!option("stop_gate") || data.stop_hook_active) return;
  const paragraph = lastParagraph(data.last_assistant_message ?? "");
  if (!ANNOUNCES.some((re) => re.test(paragraph)) || WAITS.test(paragraph))
    return;
  if (askedUser(data.transcript_path)) return;
  const reason =
    "Your reply ends with a next step or an offer, not with finished work: " +
    `"${paragraph.slice(0, 200)}". The user must answer before that work happens, which costs a turn. ` +
    "If the step is part of the request or the approved plan, do that work now and then report. " +
    "If only the user can decide it, or the user asked only a question, end the turn again with no change.";
  logVerdict(data, "block", reason);
  emit({ decision: "block", reason });
});
