// The user's Claude plan, from the account that Claude Code caches in
// `.claude.json` (`oauthAccount`). Only these plan fields are read. Tokens
// live in the keychain or `.credentials.json`, and this file never opens them.
// Field values were seen on Claude Code 2.1.289 (`docs/dossier/plans-and-models.md`).

// It reads no file, because the hooks module may not import `node:fs`.
// Each caller reads `claudeJsonPath(env)` and gives its text to `accountFrom`.

import { API_CACHE_TTL_MS, CACHE_TTL_MS } from "./_budget.mjs";

export const PLANS = ["api", "pro", "max5", "max20", "team", "enterprise"];

const LABELS = {
  api: "pay-per-token API",
  pro: "Claude Pro",
  max5: "Claude Max 5x",
  max20: "Claude Max 20x",
  team: "Claude Team",
  enterprise: "Claude Enterprise",
};

const PROVIDERS = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];
const ON = new Set(["1", "true", "yes", "on"]);

/** The path of `.claude.json`: in `CLAUDE_CONFIG_DIR`, or in the home dir. */
export const claudeJsonPath = (env) =>
  `${env.CLAUDE_CONFIG_DIR || env.HOME}/.claude.json`;

/** The cached `oauthAccount` in the text of `.claude.json`, or null. */
export function accountFrom(text) {
  try {
    const account = JSON.parse(text).oauthAccount;
    return account && typeof account === "object" ? account : null;
  } catch {
    return null;
  }
}

/** A plan id, or `unknown`, from the account and the environment. */
export function detectPlan(env, account) {
  if (PROVIDERS.some((name) => ON.has(String(env[name] ?? "").toLowerCase())))
    return "api";
  if (!account) return env.ANTHROPIC_API_KEY ? "api" : "unknown";
  if (account.billingType === "usage_based") return "api";
  const tier = account.userRateLimitTier ?? account.organizationRateLimitTier;
  switch (account.organizationType) {
    case "claude_pro":
      return "pro";
    case "claude_max":
      return tier === "default_claude_max_20x" ? "max20" : "max5";
    case "claude_team":
      return "team";
    case "claude_enterprise":
      return "enterprise";
    default:
      return "unknown";
  }
}

/**
 * Time after the last turn at which the main prompt cache has expired.
 * An unknown plan gets the longer time, so it warns less often.
 */
export const cacheTtlMs = (plan) =>
  plan === "api" ? API_CACHE_TTL_MS : CACHE_TTL_MS;

/** The label of a plan id. */
export const planLabel = (plan) => LABELS[plan] ?? "unknown";
