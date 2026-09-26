#!/usr/bin/env bun
// PreModelSwitch: block a switch to a model outside the allowlist.

import { emit, option, run } from "../lib/_common.mjs";
import { allowed } from "../lib/_models.mjs";
import { planAllowlist } from "../lib/_plans.mjs";

run((data) => {
  if (!option("model_lock")) return;
  const { list, note } = planAllowlist();
  const target = data.to_model ?? "";
  if (target && !allowed(target, list)) {
    emit({
      decision: "block",
      reason: `only these models are allowed: ${list.join(", ")}.${note}`,
    });
  }
});
