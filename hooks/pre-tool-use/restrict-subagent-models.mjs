#!/usr/bin/env bun
// PreToolUse(Agent): deny a subagent `model` outside the allowlist, and Fable
// for any subagent. A fresh Fable context pays Claude Code's whole system
// prompt at 2.5x Opus 5.5's rate before doing any work, and Fable spends the
// same weekly limit as every other model.

import { option, preToolDecision, run } from "../lib/_common.mjs";
import { allowed, canonical } from "../lib/_models.mjs";
import { planAllowlist } from "../lib/_plans.mjs";

const HINT = `Omit \`model\` to use the agent's own model. For fully specified, mechanical work use \`dotclaude:mechanical-worker\` (Sonnet 5.5).`;

function isFable(model) {
  const m = canonical(model);
  const mapped = m === "fable" ? process.env.ANTHROPIC_DEFAULT_FABLE_MODEL : "";
  return /fable/.test(mapped ? canonical(mapped) : m);
}

run((data) => {
  if (!option("model_lock")) return;
  const model = data.tool_input?.model;
  if (typeof model !== "string") return;
  if (isFable(model)) {
    preToolDecision(
      "deny",
      `dotclaude blocks Fable for subagents, because a fresh Fable context costs about 2.5x an Opus 5.5 context before any work. That cost comes from the same weekly limit. ${HINT}`,
    );
    return;
  }
  const { list, note } = planAllowlist();
  if (!allowed(model, list))
    preToolDecision(
      "deny",
      `Subagent model \`${model}\` is outside the allowed models (${list.map((m) => `\`${m}\``).join(", ")}).${note} ${HINT}`,
    );
});
