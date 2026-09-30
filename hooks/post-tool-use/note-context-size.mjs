#!/usr/bin/env bun
// PostToolUse: in a long run with no typed prompt, tell the main agent its
// context size once when it passes CONTEXT_NOTE_TOKENS. The prompt note only
// comes when the user types, and no hook input gives the context size.

import { emit, option, run } from "../lib/_common.mjs";
import { contextNote } from "../lib/_usage.mjs";

run((data) => {
  if (!option("usage_notes")) return;
  // A subagent's tool call: the note is about the main context.
  if (data.agent_id) return;
  const note = contextNote(data, true);
  if (!note) return;
  emit({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: note,
    },
  });
});
