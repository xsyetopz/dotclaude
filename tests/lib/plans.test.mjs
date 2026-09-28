// Claude plan detection and what the model lock and session notes do with it.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  currentPlan,
  detectPlan,
  fableAccess,
  planAllowlist,
  planNote,
} from "../../hooks/lib/_plans.mjs";

const HOOKS = path.resolve(import.meta.dirname, "../../hooks");

/** A config dir holding .claude.json with this oauthAccount (or none). */
function configDir(oauthAccount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-plan-"));
  if (oauthAccount)
    fs.writeFileSync(
      path.join(dir, ".claude.json"),
      JSON.stringify({ oauthAccount }),
    );
  return dir;
}

const PRO = { organizationType: "claude_pro", hasExtraUsageEnabled: false };
const MAX_20X = {
  organizationType: "claude_max",
  organizationRateLimitTier: "default_claude_max_20x",
};

test("detectPlan follows Claude Code's organization types and rate-limit tiers", () => {
  const cases = [
    [PRO, "pro"],
    [MAX_20X, "max_20x"],
    [
      {
        organizationType: "claude_max",
        organizationRateLimitTier: "default_claude_max_5x",
      },
      "max_5x",
    ],
    [
      {
        organizationType: "claude_team",
        organizationRateLimitTier: "default_claude_max_5x",
      },
      "team_premium",
    ],
    [{ organizationType: "claude_team" }, "team_standard"],
    [{ organizationType: "claude_enterprise" }, "enterprise"],
    [
      { organizationType: "claude_enterprise", billingType: "usage_based" },
      "api",
    ],
    [{ organizationType: "something_new" }, null],
  ];
  for (const [account, plan] of cases)
    expect(detectPlan(account, {}), JSON.stringify(account)).toBe(plan);
  expect(detectPlan(null, {})).toBe(null);
  expect(detectPlan(null, { ANTHROPIC_API_KEY: "x" })).toBe("api");
  expect(detectPlan(MAX_20X, { CLAUDE_CODE_USE_BEDROCK: "1" })).toBe("api");
});

test("the claude_plan option overrides detection; junk values fall back to it", () => {
  expect(
    currentPlan({ CLAUDE_PLUGIN_OPTION_CLAUDE_PLAN: "max_5x" }, PRO),
  ).toStrictEqual({ plan: "max_5x", detected: false });
  expect(
    currentPlan({ CLAUDE_PLUGIN_OPTION_CLAUDE_PLAN: "auto" }, PRO).plan,
  ).toBe("pro");
  expect(
    currentPlan({ CLAUDE_PLUGIN_OPTION_CLAUDE_PLAN: "ultra" }, PRO).plan,
  ).toBe("pro");
});

test("fableAccess matches the plans Anthropic includes Fable in", () => {
  expect(fableAccess("max_20x")).toBe("included");
  expect(fableAccess("team_premium")).toBe("included");
  expect(fableAccess("pro", PRO)).toBe("unavailable");
  expect(fableAccess("pro", { ...PRO, hasExtraUsageEnabled: true })).toBe(
    "credits",
  );
  expect(fableAccess("api")).toBe("api");
  expect(fableAccess("enterprise")).toBe(null);
  expect(fableAccess(null)).toBe(null);
});

test("planAllowlist drops Fable only where the plan cannot run it", () => {
  const pro = planAllowlist({ CLAUDE_CONFIG_DIR: configDir(PRO) });
  expect(!pro.list.some((m) => /fable/.test(m))).toBeTruthy();
  expect(pro.list.includes("claude-sonnet-5")).toBeTruthy();
  expect(pro.note).toMatch(
    /Claude Pro plan excludes Fable models because it runs them on usage credits/,
  );
  const max = planAllowlist({ CLAUDE_CONFIG_DIR: configDir(MAX_20X) });
  expect(max.list.includes("claude-fable-5-1")).toBeTruthy();
  expect(max.note).toBe("");
  const unknown = planAllowlist({ CLAUDE_CONFIG_DIR: configDir(null) });
  expect(unknown.list.includes("claude-fable-5-1")).toBeTruthy();
});

test("planNote describes Fable per plan and one Pro-sized handoff bound for every plan", () => {
  const max = planNote({ CLAUDE_CONFIG_DIR: configDir(MAX_20X) });
  expect(max).toMatch(/Claude Max 20x \(detected\)/);
  expect(max).toMatch(/up to 50% of it/);
  expect(max).toMatch(/passes about 200k tokens/);
  const pro = planNote({ CLAUDE_CONFIG_DIR: configDir(PRO) });
  expect(pro).toMatch(/model lock excludes it/);
  expect(pro).toMatch(/passes about 200k tokens/);
  expect(planNote({ CLAUDE_CONFIG_DIR: configDir(null) })).toBe(null);
});

function hook(script, input, env) {
  const res = spawnSync("bun", [path.join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "",
      ...env,
    },
  });
  expect(res.status, res.stderr).toBe(0);
  return res.stdout ? JSON.parse(res.stdout) : null;
}

test("on Pro without extra usage, a switch to Fable is blocked with the reason", () => {
  const out = hook(
    "pre-model-switch/restrict-models.mjs",
    { hook_event_name: "PreModelSwitch", to_model: "claude-fable-5-1" },
    { CLAUDE_CONFIG_DIR: configDir(PRO) },
  );
  expect(out.decision).toBe("block");
  expect(out.reason).toMatch(/extra usage is off/);
  expect(
    hook(
      "pre-model-switch/restrict-models.mjs",
      { hook_event_name: "PreModelSwitch", to_model: "claude-fable-5-1" },
      { CLAUDE_CONFIG_DIR: configDir(MAX_20X) },
    ),
  ).toBe(null);
});

test("session start carries the plan note, once per new session", () => {
  const start = (source) =>
    hook(
      "session-start/add-session-notes.mjs",
      { hook_event_name: "SessionStart", source, model: "claude-opus-5-5" },
      { CLAUDE_CONFIG_DIR: configDir(MAX_20X) },
    );
  expect(start("startup").hookSpecificOutput.additionalContext).toMatch(
    /<claude_plan source="dotclaude">/,
  );
  expect(start("resume")).toBe(null);
});
