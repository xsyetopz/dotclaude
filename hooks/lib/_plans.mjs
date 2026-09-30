// The user's Claude plan and what dotclaude changes for it.
//
// The plan comes from the `claude_plan` option, or with `auto` from the
// account Claude Code caches in ~/.claude.json (`oauthAccount`). The mapping
// follows Claude Code 2.1.283: organizationType claude_pro/claude_max/
// claude_team/claude_enterprise is the subscription type, and a Team account
// on the `default_claude_max_5x` rate-limit tier is a premium seat.
// Only these plan fields are read; tokens live in the keychain and are never
// touched.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMPACTIONS_BEFORE_HANDOFF,
  k,
  MAIN_CONTEXT_TOKENS,
} from "./_budget.mjs";
import { optionList } from "./_common.mjs";
import { canonical, DEFAULT_ALLOWED } from "./_models.mjs";

export const PLANS = [
  "pro",
  "max_5x",
  "max_20x",
  "team_standard",
  "team_premium",
  "enterprise",
  "api",
];

const LABELS = {
  pro: "Claude Pro",
  max_5x: "Claude Max 5x",
  max_20x: "Claude Max 20x",
  team_standard: "Claude Team (standard seat)",
  team_premium: "Claude Team (premium seat)",
  enterprise: "Claude Enterprise",
  api: "pay-per-token API",
};

const TYPES = {
  claude_pro: "pro",
  claude_max: "max",
  claude_team: "team",
  claude_enterprise: "enterprise",
};

const ON = new Set(["1", "true", "yes", "on"]);

/** Claude Code's global config, ~/.claude.json, or null. */
export function readConfig(env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR || os.homedir();
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(dir, ".claude.json"), "utf8"),
    );
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export function readAccount(env = process.env) {
  const a = readConfig(env)?.oauthAccount;
  return a && typeof a === "object" ? a : null;
}

/** The plan an account and environment imply, or null when unknown. */
export function detectPlan(account, env = process.env) {
  const provider = [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ].some((k) => ON.has(String(env[k] ?? "").toLowerCase()));
  if (provider) return "api";
  if (!account) return env.ANTHROPIC_API_KEY ? "api" : null;
  if (account.billingType === "usage_based") return "api";
  const tier = account.userRateLimitTier ?? account.organizationRateLimitTier;
  switch (TYPES[account.organizationType]) {
    case "pro":
      return "pro";
    case "max":
      return tier === "default_claude_max_20x" ? "max_20x" : "max_5x";
    case "team":
      return tier === "default_claude_max_5x"
        ? "team_premium"
        : "team_standard";
    case "enterprise":
      return "enterprise";
    default:
      return null;
  }
}

/** The configured plan, or the detected one for `auto`. */
export function currentPlan(env = process.env, account = undefined) {
  const set = String(env.CLAUDE_PLUGIN_OPTION_CLAUDE_PLAN ?? "")
    .trim()
    .toLowerCase();
  if (PLANS.includes(set)) return { plan: set, detected: false };
  const acc = account === undefined ? readAccount(env) : account;
  return { plan: detectPlan(acc, env), detected: true, account: acc };
}

/**
 * How Fable runs on a plan (support.claude.com article 15424964):
 * "included" up to 50% of the weekly limit (Max, Team premium seats);
 * "credits" on usage credits (Pro and Team standard seats with extra usage);
 * "unavailable" (the same seats without extra usage); "api" at API rates;
 * null when dotclaude cannot tell (Enterprise seats, unknown plan).
 */
export function fableAccess(plan, account = null) {
  switch (plan) {
    case "max_5x":
    case "max_20x":
    case "team_premium":
      return "included";
    case "pro":
    case "team_standard":
      return account?.hasExtraUsageEnabled === true ? "credits" : "unavailable";
    case "api":
      return "api";
    default:
      return null;
  }
}

/**
 * The model allowlist for the current plan: `allowed_models`, minus Fable when
 * the plan cannot run it. `note` explains the removal for deny messages.
 */
export function planAllowlist(env = process.env) {
  const list = optionList("allowed_models", DEFAULT_ALLOWED);
  const { plan, account } = currentPlan(env);
  if (fableAccess(plan, account) !== "unavailable") return { list, note: "" };
  return {
    list: list.filter((m) => !/fable/.test(canonical(m))),
    note: ` The ${LABELS[plan]} plan excludes Fable models because it runs them on usage credits and extra usage is off.`,
  };
}

/** Session-start note for the plan, or null when there is nothing to say. */
export function planNote(env = process.env) {
  const { plan, detected, account } = currentPlan(env);
  if (!plan) return null;
  const lines = [
    `Claude plan: ${LABELS[plan]} (${detected ? "detected" : "set in dotclaude's `claude_plan` option"}).`,
  ];
  const fable = fableAccess(plan, account);
  switch (fable) {
    case "included":
      lines.push(
        "Fable 5.1 draws from the same weekly limit as every other model, up to 50% of it. Per token it costs 2.5x Opus 5.5 for input, output, and cache writes, and 1.25x for cache reads. Use it in the main conversation for planning or advice when Opus 5.5 did not solve the problem. Do not use it for routine work.",
      );
      break;
    case "credits":
      lines.push(
        "Fable 5.1 is not in this plan's limits and runs on paid usage credits. Switch to it only when the user asks.",
      );
      break;
    case "unavailable":
      lines.push(
        "Fable 5.1 is not in this plan's limits and extra usage is off, so dotclaude's model lock excludes it.",
      );
      break;
    case "api":
      lines.push(
        "Usage is billed per token. For input, output, and cache writes, Fable 5.1 costs 2.5x Opus 5.5, Opus 5.5 2x Sonnet 5.5, and Sonnet 5.5 2x Haiku 4.5. Cache reads are most of a long session's cost. They cost $0.25 per million on Fable 5.1, $0.20 on Opus 5.5 and Sonnet 5.5, and $0.10 on Haiku 4.5.",
      );
      break;
  }
  // One bound for every plan, sized for Pro: larger plans only run out later.
  lines.push(
    `Every turn re-reads the whole context. Claude Code compacts the main conversation automatically before it reaches ${k(MAIN_CONTEXT_TOKENS)} tokens. Let the first ${COMPACTIONS_BEFORE_HANDOFF} compactions occur. After them, dotclaude tells you the context size. Then write a handoff note with the \`write-session-handoff\` skill before you finish the current step, continue the work, and ask the user to run \`/clear\` at the next natural stop. The note does not stop the work. Do not start a handoff on your own estimate of the context size. Keep subagent briefs small. Use few subagents. dotclaude sizes this for Pro's 5-hour window and applies it on every plan. Larger plans only reach their limits later.`,
  );
  return `<claude_plan source="dotclaude">\n${lines.join("\n")}\n</claude_plan>`;
}
