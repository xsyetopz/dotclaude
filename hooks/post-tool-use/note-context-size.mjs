// PostToolUse: in a long run with no typed prompt, tell the main agent its
// context size once when it passes CONTEXT_NOTE_TOKENS. The prompt note only
// comes when the user types, and no hook input gives the context size.

import { contextNote, markContextNote } from "../lib/_context-note.mjs";
import { option } from "../lib/_core.mjs";

// A handoff note, which the `handoff` skill writes.
const HANDOFF = /(?:^|\/)\.claude\/handoffs\/[^/]+$/;

export default async function (io, data) {
  if (!option(io.env, "usage_notes")) return;
  // A subagent's tool call: the note is about the main context.
  if (data.agent_id) return;
  // A call that writes a handoff note marks the note as given, so the next
  // call does not ask for the handoff that Claude just wrote.
  const file = String(data.tool_input?.file_path ?? "").replaceAll("\\", "/");
  if (HANDOFF.test(file)) {
    await markContextNote(io, data);
    return;
  }
  const note = await contextNote(io, data, true);
  if (!note) return;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: note,
    },
  };
}
