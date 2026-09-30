#!/usr/bin/env bun
// SessionStart: short notes Claude cannot get any other way. On Fable 5.1 it
// adds the model's adjustments to the Opus-tuned output style. It names the
// user's Claude plan and what that means for model choice, and gives the
// commit and pull request attribution lines and the pre-commit skill line
// that the profile's `includeGitInstructions: false` drops.

import { attributionNote, preCommitNote } from "../lib/_attribution.mjs";
import { emit, option, projectRoot, pruneState, run } from "../lib/_common.mjs";
import { FABLE, isFable } from "../lib/_model-notes.mjs";
import { planNote } from "../lib/_plans.mjs";

run((data) => {
  const parts = [];
  // A resumed or forked transcript already holds the note from its first
  // session, and a model restored on resume reaches PostModelSwitch.
  const continued = data.source === "resume" || data.source === "fork";
  if (!continued && isFable(data.model)) parts.push(FABLE);
  if (data.source === "startup") pruneState();
  if (!continued) {
    const plan = planNote();
    if (plan) parts.push(plan);
    if (option("git_attribution")) {
      const attribution = attributionNote(data.model, projectRoot(data));
      if (attribution) parts.push(attribution);
    }
    const preCommit = preCommitNote(projectRoot(data));
    if (preCommit) parts.push(preCommit);
  }
  if (!parts.length) return;
  emit({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: parts.join("\n"),
    },
  });
});
