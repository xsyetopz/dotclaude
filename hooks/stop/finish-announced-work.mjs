#!/usr/bin/env bun

// Stop hook: send Claude back once when the last paragraph of its reply
// announces the next step ("Next I'll ..."), asks permission for work
// ("Should I ...?", "Want me to ...?"), or defers it ("not fixed", "left as
// a follow-up") instead of doing it. In the audited
// sessions, 54 of 439 user messages only answered such an ending.
//
// It passes on the second stop of a turn, after an `AskUserQuestion` or
// `ExitPlanMode` call, and when the paragraph asks the user to approve a push,
// a publish, a delete, a release, or a commit, or to allow a command that was
// denied, because those wait for the user.
//
// From 2026-09-29 to 2026-10-02, 7 of its 11 blocks were choices that only
// the user could make, and Claude ended the turn again with no change. The
// text of a reply or a prompt can be in any language, so the hook does not
// read it for a choice. The working rules and the block reason tell Claude to
// ask a choice with `AskUserQuestion`, which the hook detects.

import { run, stopFeedback } from "../lib/_common.mjs";
import { option } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { waitsForUser } from "../lib/_transcript.mjs";
import { logVerdict } from "../lib/_verdicts.mjs";

const ANNOUNCES = [
  /\b(?:next|now|then),? I(?:'ll| will)\b/i,
  /\bI(?:'ll| will) (?:now|next)\b/i,
  /\b(?:should|shall) I\b/i,
  /\b(?:do you )?want me to\b/i,
  /\bwould you like me to\b/i,
  /\bI can\b[^.?!]*\bif you(?:'d)? (?:want|like)\b/i,
  /\blet me know if you(?:'d like| want)\b/i,
  /\bif you want\b/i,
  /\bsay so\b|\bsay the word\b/i,
  /\byour call\b|\bdecision for you\b/i,
  /\bstill unapplied\b|\bnot applied yet\b/i,
  // Deferrals: the work is named and left undone.
  /\bnot fixed\b/i,
  /\bleft as a follow-up\b|\bfollow-up:/i,
  /\bin a later (?:release|version)\b|\bnext version\b/i,
];

// Steps that wait for the user: other people see them, or they are hard to
// reverse. Only a question about one of them is exempt. A deferral that
// names a release or a tag is not.
const WAITS = /\b(?:push|publish|delete|bump|release|tag|merge|commit)\w*\b/i;

// A request to allow a command that a hook or the user denied.
const ALLOW = /\b(?:allow|approve)\s+`/i;

function lastParagraph(message) {
  const parts = message
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.at(-1) ?? "";
}

run(async (data) => {
  if (!option(process.env, "gate_verify") || data.stop_hook_active) return;
  const paragraph = lastParagraph(data.last_assistant_message ?? "");
  if (!ANNOUNCES.some((re) => re.test(paragraph))) return;
  if (paragraph.includes("?") && WAITS.test(paragraph)) return;
  if (ALLOW.test(paragraph)) return;
  if (waitsForUser(data.transcript_path)) return;
  const reason =
    "The last paragraph of your reply announces, offers, or defers work that is not done: " +
    `"${paragraph.slice(0, 200)}". The user then sends one more message before that work starts, and each message costs a turn. ` +
    "If the request or the approved plan includes this work, do it now, and then report. " +
    "If only the user can make this decision, ask it with `AskUserQuestion`, because the user then answers with one choice, and this hook does not stop a turn that waits for that answer. " +
    "If the work is outside the request, or the user asked only a question, end the turn again with no change.";
  await logVerdict(nodeIo(data), data, "block", reason);
  stopFeedback(data, reason);
});
