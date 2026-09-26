#!/usr/bin/env bun
// PreToolUse(Agent): deny a subagent `model` outside the allowlist.

import { option, optionList, preToolDecision, run } from "../lib/_common.mjs";
import { allowed, DEFAULT_ALLOWED } from "../lib/_models.mjs";

run((data) => {
  if (!option("model_lock")) return;
  const list = optionList("allowed_models", DEFAULT_ALLOWED);
  const model = data.tool_input?.model;
  if (typeof model === "string" && !allowed(model, list)) {
    preToolDecision(
      "deny",
      `Subagent model \`${model}\` is outside the allowed models (${list.join(", ")}). Omit \`model\` to use the agent's own model. For mechanical, well-specified work, use the \`dotclaude:mechanical-worker\` agent (Opus 5.5 at low effort) where you would have picked Sonnet; for web research, \`dotclaude:web-researcher\` (Haiku 4.5).`,
    );
  }
});
