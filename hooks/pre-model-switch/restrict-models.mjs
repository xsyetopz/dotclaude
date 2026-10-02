#!/usr/bin/env bun

// PreModelSwitch: block a switch to a model outside the allowlist.

import { emit, run } from "../lib/_common.mjs";
import { option } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { allowed } from "../lib/_models.mjs";
import { planAllowlist } from "../lib/_plans.mjs";

run(async (data) => {
  const io = nodeIo(data);
  if (!option(io.env, "model_lock")) return;
  const { list, note } = await planAllowlist(io);
  const target = data.to_model ?? "";
  if (target && !allowed(target, list, io.env)) {
    emit({
      decision: "block",
      reason: `the model lock allows only these models: ${list.join(", ")}.${note}`,
    });
  }
});
