// Claude plan detection and what the model lock and session notes do with it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  currentPlan,
  detectPlan,
  fableAccess,
  planAllowlist,
  planNote,
} from "../hooks/lib/_plans.mjs";

const HOOKS = path.resolve(import.meta.dirname, "../hooks");

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
    assert.equal(detectPlan(account, {}), plan, JSON.stringify(account));
  assert.equal(detectPlan(null, {}), null);
  assert.equal(detectPlan(null, { ANTHROPIC_API_KEY: "x" }), "api");
  assert.equal(detectPlan(MAX_20X, { CLAUDE_CODE_USE_BEDROCK: "1" }), "api");
});

test("the claude_plan option overrides detection; junk values fall back to it", () => {
  assert.deepEqual(
    currentPlan({ CLAUDE_PLUGIN_OPTION_CLAUDE_PLAN: "max_5x" }, PRO),
    { plan: "max_5x", detected: false },
  );
  assert.equal(
    currentPlan({ CLAUDE_PLUGIN_OPTION_CLAUDE_PLAN: "auto" }, PRO).plan,
    "pro",
  );
  assert.equal(
    currentPlan({ CLAUDE_PLUGIN_OPTION_CLAUDE_PLAN: "ultra" }, PRO).plan,
    "pro",
  );
});

test("fableAccess matches the plans Anthropic includes Fable in", () => {
  assert.equal(fableAccess("max_20x"), "included");
  assert.equal(fableAccess("team_premium"), "included");
  assert.equal(fableAccess("pro", PRO), "unavailable");
  assert.equal(
    fableAccess("pro", { ...PRO, hasExtraUsageEnabled: true }),
    "credits",
  );
  assert.equal(fableAccess("api"), "api");
  assert.equal(fableAccess("enterprise"), null);
  assert.equal(fableAccess(null), null);
});

test("planAllowlist drops Fable only where the plan cannot run it", () => {
  const pro = planAllowlist({ CLAUDE_CONFIG_DIR: configDir(PRO) });
  assert.ok(!pro.list.some((m) => /fable/.test(m)));
  assert.ok(pro.list.includes("claude-sonnet-5"));
  assert.match(pro.note, /Claude Pro plan runs them on usage credits/);
  const max = planAllowlist({ CLAUDE_CONFIG_DIR: configDir(MAX_20X) });
  assert.ok(max.list.includes("claude-fable-5-1"));
  assert.equal(max.note, "");
  const unknown = planAllowlist({ CLAUDE_CONFIG_DIR: configDir(null) });
  assert.ok(unknown.list.includes("claude-fable-5-1"));
});

test("planNote describes Fable's weekly cap on Max and the small window on Pro", () => {
  const max = planNote({ CLAUDE_CONFIG_DIR: configDir(MAX_20X) });
  assert.match(max, /Claude Max 20x \(detected\)/);
  assert.match(max, /up to 50% of it/);
  assert.doesNotMatch(max, /5-hour window is small/);
  const pro = planNote({ CLAUDE_CONFIG_DIR: configDir(PRO) });
  assert.match(pro, /leaves it out/);
  assert.match(pro, /5-hour window is small/);
  assert.equal(planNote({ CLAUDE_CONFIG_DIR: configDir(null) }), null);
});

function hook(script, input, env) {
  const res = spawnSync("bun", [path.join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: configDir(null),
      ANTHROPIC_API_KEY: "",
      ...env,
    },
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout ? JSON.parse(res.stdout) : null;
}

test("on Pro without extra usage, a switch to Fable is blocked with the reason", () => {
  const out = hook(
    "pre-model-switch/restrict-models.mjs",
    { hook_event_name: "PreModelSwitch", to_model: "claude-fable-5-1" },
    { CLAUDE_CONFIG_DIR: configDir(PRO) },
  );
  assert.equal(out.decision, "block");
  assert.match(out.reason, /extra usage is off/);
  assert.equal(
    hook(
      "pre-model-switch/restrict-models.mjs",
      { hook_event_name: "PreModelSwitch", to_model: "claude-fable-5-1" },
      { CLAUDE_CONFIG_DIR: configDir(MAX_20X) },
    ),
    null,
  );
});

test("session start carries the plan note, once per new session", () => {
  const start = (source) =>
    hook(
      "session-start/add-session-notes.mjs",
      { hook_event_name: "SessionStart", source, model: "claude-opus-5-5" },
      { CLAUDE_CONFIG_DIR: configDir(MAX_20X) },
    );
  assert.match(
    start("startup").hookSpecificOutput.additionalContext,
    /<claude_plan source="dotclaude">/,
  );
  assert.equal(start("resume"), null);
});
