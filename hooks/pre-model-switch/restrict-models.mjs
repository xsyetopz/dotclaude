#!/usr/bin/env bun
// PreModelSwitch: block a switch to a model outside the allowlist.

import { emit, option, optionList, run } from "../lib/_common.mjs";
import { allowed, DEFAULT_ALLOWED } from "../lib/_models.mjs";

run((data) => {
  if (!option("model_lock")) return;
  const list = optionList("allowed_models", DEFAULT_ALLOWED);
  const target = data.to_model ?? "";
  if (target && !allowed(target, list)) {
    emit({
      decision: "block",
      reason: `dotclaude allows only these models: ${list.join(", ")}.`,
    });
  }
});
