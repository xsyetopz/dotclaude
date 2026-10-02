// PostToolUse: in a long run with no typed prompt, tell the main agent its
// context size once when it passes CONTEXT_NOTE_TOKENS. The prompt note only
// comes when the user types, and no hook input gives the context size.

import { option } from "../lib/_core.mjs";
import { contextNote } from "../lib/_usage.mjs";

export default async function (io, data) {
  if (!option(io.env, "usage_notes")) return;
  // A subagent's tool call: the note is about the main context.
  if (data.agent_id) return;
  const note = await contextNote(io, data, true);
  if (!note) return;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: note,
    },
  };
}
