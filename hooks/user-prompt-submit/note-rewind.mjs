#!/usr/bin/env bun
// UserPromptSubmit: two notes to the user, each shown once.
//
// - On the third correction in a row: the failed attempts stay in the
//   context and steer the next attempt, so a rewind to before them, or a
//   handoff and `/clear`, often works better than a fourth correction.
// - After a reply that stopped with `stop_reason` `refusal`: the refusal stays
//   in the context and can fire again, even after a model switch, so a new
//   session is the fix. StopFailure has no `refusal` matcher, so this reads
//   the transcript.
//
// The notes go to the user only (`systemMessage`), so they add nothing to
// the context.

import fs from "node:fs";
import path from "node:path";
import { emit, option, run, stateDir, userTyped } from "../lib/_common.mjs";
import { tail } from "../lib/_transcript.mjs";

const CORRECTIONS_FOR_NOTE = 3;

// A prompt that says the last attempt did not work.
const CORRECTION =
  /^\s*(?:no\b|nope\b|wrong\b|that'?s (?:not|wrong)\b|still\b|it still\b|(?:it |this )?(?:still )?doesn'?t work|not what\b|i said\b|you (?:didn'?t|still|broke|missed)\b|same (?:error|problem|issue)\b)/i;

function stateFile(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(stateDir(), `${safe}.rewind.json`);
}

/** The id of the last main reply if it stopped with a refusal, else null. */
function refusalId(transcriptPath) {
  const text = transcriptPath ? tail(transcriptPath, 500_000) : null;
  if (!text) return null;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.type !== "assistant" || entry.isSidechain) continue;
    const m = entry.message;
    return m?.stop_reason === "refusal" ? (m.id ?? entry.uuid ?? "?") : null;
  }
  return null;
}

run((data) => {
  if (!option("usage_notes") || !data.session_id) return;
  if (!userTyped(data.prompt)) return;
  const file = stateFile(data.session_id);
  let state = { corrections: 0, refusal: null };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    // First prompt with this note.
  }
  const notes = [];
  const refusal = refusalId(data.transcript_path);
  if (refusal && refusal !== state.refusal) {
    state.refusal = refusal;
    notes.push(
      "The last reply stopped with a refusal. The refusal stays in this session's context and can stop later replies too, also after a model switch. Start a new session for this work, with a short handoff if you need one.",
    );
  }
  state.corrections = CORRECTION.test(data.prompt) ? state.corrections + 1 : 0;
  if (state.corrections >= CORRECTIONS_FOR_NOTE) {
    state.corrections = 0;
    notes.push(
      "This is the third correction in a row. The failed attempts stay in the context and steer the next one. Rewind to before them (`/rewind` or Esc twice) and give the fix with your first message, or ask for a handoff note and `/clear`.",
    );
  }
  fs.writeFileSync(file, JSON.stringify(state));
  if (notes.length) emit({ systemMessage: notes.join("\n") });
});
