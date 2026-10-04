import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_CACHE_TTL_MS, CACHE_TTL_MS } from "../hooks/lib/_budget.mjs";
import { accountFrom, cacheTtlMs, detectPlan } from "../hooks/lib/_plan.mjs";
import { contextFor } from "../hooks/session-start/context.mjs";

// Fake accounts only. No test reads real credentials.
const plan = (account, env = {}) =>
  detectPlan(env, accountFrom(JSON.stringify({ oauthAccount: account })));

test("the account fields give the plan", () => {
  expect(plan({ organizationType: "claude_pro" })).toBe("pro");
  expect(
    plan({
      organizationType: "claude_max",
      organizationRateLimitTier: "default_claude_max_20x",
    }),
  ).toBe("max20");
  expect(
    plan({
      organizationType: "claude_max",
      organizationRateLimitTier: "default_claude_max_5x",
    }),
  ).toBe("max5");
  expect(plan({ organizationType: "claude_team" })).toBe("team");
  expect(plan({ organizationType: "claude_enterprise" })).toBe("enterprise");
  expect(
    plan({ organizationType: "claude_pro", billingType: "usage_based" }),
  ).toBe("api");
  expect(plan({ organizationType: "other" })).toBe("unknown");
});

test("a provider or an API key without an account gives api", () => {
  expect(plan(undefined)).toBe("unknown");
  expect(plan(undefined, { ANTHROPIC_API_KEY: "x" })).toBe("api");
  expect(
    plan({ organizationType: "claude_pro" }, { CLAUDE_CODE_USE_BEDROCK: "1" }),
  ).toBe("api");
});

test("a broken config file gives unknown and no account", () => {
  expect(accountFrom("{nope")).toBeNull();
  expect(accountFrom("")).toBeNull();
  expect(detectPlan({}, null)).toBe("unknown");
});

test("the cache lives 5 minutes on api and 1 hour elsewhere", () => {
  expect(cacheTtlMs("api")).toBe(API_CACHE_TTL_MS);
  for (const p of ["pro", "max5", "max20", "team", "enterprise", "unknown"])
    expect(cacheTtlMs(p)).toBe(CACHE_TTL_MS);
});

test("only the api plan adds a SessionStart plan note", () => {
  const data = { source: "startup" };
  const root = mkdtempSync(join(tmpdir(), "ss-"));
  expect(contextFor(data, root, "api").join("\n")).toContain("5 minutes");
  expect(contextFor(data, root, "max20").join("\n")).not.toContain(
    "claude_plan",
  );
});
