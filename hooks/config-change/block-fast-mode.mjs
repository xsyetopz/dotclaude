#!/usr/bin/env bun
// ConfigChange: block a user/project/local settings change that turns fast mode on.

import fs from "node:fs";
import { emit, option, run } from "../lib/_common.mjs";

run((data) => {
  if (
    !option("model_lock") ||
    data.source === "policy_settings" ||
    data.source === "skills" ||
    !data.file_path
  )
    return;
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(data.file_path, "utf8"));
  } catch {
    return;
  }
  const env = settings?.env ?? {};
  const fastEnvOff =
    Object.hasOwn(env, "CLAUDE_CODE_DISABLE_FAST_MODE") &&
    String(env.CLAUDE_CODE_DISABLE_FAST_MODE) !== "1";
  if (settings?.fastMode === true || fastEnvOff) {
    emit({
      decision: "block",
      reason: "dotclaude's model lock keeps fast mode off",
    });
  }
});
