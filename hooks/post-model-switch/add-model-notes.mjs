#!/usr/bin/env bun
// PostModelSwitch: carry the per-model notes across a mid-session switch.
// Switching to Fable 5.1 adds its adjustments; switching away from it says
// they no longer apply. Claude Code delivers the context with the next request.

import { emit, run } from "../lib/_common.mjs";
import { FABLE, FABLE_OFF, isFable } from "../lib/_model-notes.mjs";

run((data) => {
  let note = null;
  if (isFable(data.to_model)) note = FABLE;
  else if (isFable(data.from_model)) note = FABLE_OFF;
  if (!note) return;
  emit({
    hookSpecificOutput: {
      hookEventName: "PostModelSwitch",
      additionalContext: note,
    },
  });
});
