#!/usr/bin/env bun

// PreToolUse(Agent): deny a subagent `model` outside the allowlist, and Fable
// for any subagent. A fresh Fable context pays Claude Code's whole system
// prompt at 2.5x Opus 5.5's rate before doing any work, and Fable spends the
// same weekly limit as every other model.
//
// Also deny a subagent that would run at an effort level outside
// EFFORT_LEVELS for its model. Claude Code takes the model from the call's
// `model`, then the definition; and the effort from `CLAUDE_CODE_EFFORT_LEVEL`,
// then the definition, then the session. Only dotclaude definitions are read,
// so an agent from elsewhere is checked only when the call names a model.

import { definition } from "../lib/_agents.mjs";
import { preToolDecision, run } from "../lib/_common.mjs";
import { option } from "../lib/_core.mjs";
import { allowed, canonical, effortLevels, family } from "../lib/_models.mjs";
import { planAllowlist } from "../lib/_plans.mjs";

const HINT = `Omit \`model\` to use the agent's own model. For fully specified, mechanical work use \`dotclaude:mechanical-worker\` (Sonnet 5.5).`;

function isFable(model) {
  const m = canonical(model);
  const mapped = m === "fable" ? process.env.ANTHROPIC_DEFAULT_FABLE_MODEL : "";
  return /fable/.test(mapped ? canonical(mapped) : m);
}

const list = (items) => items.map((i) => `\`${i}\``).join(", ");

/** The deny reason for an unsupported model and effort pair, or "". */
function effortReason(model, data, def) {
  const levels = effortLevels(model);
  const envEffort = process.env.CLAUDE_CODE_EFFORT_LEVEL?.trim() ?? "";
  const effort = envEffort || def?.effort || data.effort?.level || "";
  if (!levels || !effort || levels.includes(effort)) return "";
  const source = envEffort
    ? "`CLAUDE_CODE_EFFORT_LEVEL` sets it for every agent. Unset it and use `/effort` for the session."
    : def?.effort
      ? "The agent's definition sets it."
      : "The agent takes the effort of the session.";
  const next =
    family(model) === "sonnet"
      ? `Work that needs more effort than Sonnet 5.5 \`high\` needs judgment, so give it to Opus 5.5: omit \`model\` for a dotclaude agent, or set \`model: "opus"\`.`
      : `Use a lower session effort, for example \`/effort xhigh\`.`;
  return `dotclaude supports \`${model}\` only at the effort levels ${list(levels)}. This agent would run at \`${effort}\`. ${source} ${next}`;
}

run((data) => {
  if (!option(process.env, "model_lock")) return;
  const input = data.tool_input ?? {};
  const model = typeof input.model === "string" ? input.model : "";
  if (model && isFable(model)) {
    preToolDecision(
      "deny",
      `dotclaude blocks Fable for subagents, because a fresh Fable context costs about 2.5x an Opus 5.5 context before any work. That cost comes from the same weekly limit. ${HINT}`,
    );
    return;
  }
  if (model) {
    const { list: models, note } = planAllowlist();
    if (!allowed(model, models)) {
      preToolDecision(
        "deny",
        `Subagent model \`${model}\` is outside the allowed models (${list(models)}).${note} ${HINT}`,
      );
      return;
    }
  }
  const def = definition(String(input.subagent_type ?? ""));
  const target = model || (def?.model !== "inherit" ? def?.model : "") || "";
  if (!target) return;
  const reason = effortReason(target, data, def);
  if (reason) preToolDecision("deny", reason);
});
