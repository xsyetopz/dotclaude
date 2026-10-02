// Claude plan detection and what the model lock and session notes do with it.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUTO_COMPACT_TOKENS, k, LIMITS } from "../../hooks/lib/_budget.mjs";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";
import {
  currentPlan,
  detectPlan,
  fableAccess,
  PLANS,
  planAllowlist,
  planNote,
  readAccount,
} from "../../hooks/lib/_plans.mjs";

/** The Node io over a test environment. */
const ioWith = (env) => ({ ...nodeIo(), env });

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

test("the model_plan picker offers auto and each plan that the hooks read", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, "../../.claude-plugin/plugin.json"),
      "utf8",
    ),
  );
  expect(manifest.userConfig.model_plan.options).toStrictEqual([
    "auto",
    ...PLANS,
  ]);
});

test("the model_plan option overrides detection; junk values fall back to it", async () => {
  expect(
    await currentPlan(
      ioWith({ CLAUDE_PLUGIN_OPTION_MODEL_PLAN: "max_5x" }),
      PRO,
    ),
  ).toStrictEqual({ plan: "max_5x", detected: false });
  expect(
    (
      await currentPlan(
        ioWith({ CLAUDE_PLUGIN_OPTION_MODEL_PLAN: "auto" }),
        PRO,
      )
    ).plan,
  ).toBe("pro");
  expect(
    (
      await currentPlan(
        ioWith({ CLAUDE_PLUGIN_OPTION_MODEL_PLAN: "ultra" }),
        PRO,
      )
    ).plan,
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

test("planAllowlist drops Fable only where the plan cannot run it", async () => {
  const pro = await planAllowlist(
    ioWith({ CLAUDE_CONFIG_DIR: configDir(PRO) }),
  );
  expect(!pro.list.some((m) => /fable/.test(m))).toBeTruthy();
  expect(pro.list.includes("claude-sonnet-5-5")).toBeTruthy();
  // The note names the plan that caused the removal.
  expect(pro.note).toContain("Claude Pro");
  const max = await planAllowlist(
    ioWith({ CLAUDE_CONFIG_DIR: configDir(MAX_20X) }),
  );
  expect(max.list.includes("claude-fable-5-1")).toBeTruthy();
  expect(max.note).toBe("");
  const unknown = await planAllowlist(
    ioWith({ CLAUDE_CONFIG_DIR: configDir(null) }),
  );
  expect(unknown.list.includes("claude-fable-5-1")).toBeTruthy();
});

test("planNote describes Fable per plan and one Pro-sized handoff bound for every plan", async () => {
  const note = (account, env = {}) =>
    planNote(ioWith({ CLAUDE_CONFIG_DIR: configDir(account), ...env }));
  const fableLine = (text) =>
    text
      .split("\n")
      .filter((l) => l.includes("Fable"))
      .join("\n");
  const max = await note(MAX_20X);
  expect(max).toStartWith('<claude_plan source="dotclaude">');
  expect(max).toContain("Claude Max 20x");
  expect(max).toContain("50%");
  // A plan set in the option reads differently from a detected one.
  const setMax = await note(null, {
    CLAUDE_PLUGIN_OPTION_MODEL_PLAN: "max_20x",
  });
  expect(setMax).toContain("Claude Max 20x");
  expect(setMax).not.toBe(max);
  const pro = await note(PRO);
  expect(pro).toContain("Claude Pro");
  const credits = await note({ ...PRO, hasExtraUsageEnabled: true });
  const enterprise = await note({ organizationType: "claude_enterprise" });
  // Included, unavailable, and credits each get their own Fable line;
  // Enterprise gets none.
  const lines = [max, pro, credits].map(fableLine);
  for (const line of lines) expect(line).toBeTruthy();
  expect(new Set(lines).size).toBe(3);
  expect(fableLine(enterprise)).toBe("");
  const api = await note(null, { CLAUDE_PLUGIN_OPTION_MODEL_PLAN: "api" });
  // The note loads at every session start, so it holds the facts only. The
  // handoff rule is in the output style.
  for (const text of [max, pro, credits, enterprise, api]) {
    expect(text).toContain(`at about ${k(AUTO_COMPACT_TOKENS)} tokens`);
    expect(text.length).toBeLessThanOrEqual(LIMITS.sessionNoteChars.fail);
  }
  expect(await planNote(ioWith({ CLAUDE_CONFIG_DIR: configDir(null) }))).toBe(
    null,
  );
});

test("planNote names the organization budget for Team and Enterprise seats only", async () => {
  const note = (account) =>
    planNote(ioWith({ CLAUDE_CONFIG_DIR: configDir(account) }));
  const budget = (text) =>
    text.split("\n").filter((l) => l.includes("organization budget"));
  for (const account of [
    { organizationType: "claude_team" },
    { organizationType: "claude_enterprise" },
  ]) {
    const text = await note(account);
    expect(budget(text).length).toBe(1);
    expect(text.length).toBeLessThanOrEqual(LIMITS.sessionNoteChars.fail);
  }
  for (const account of [MAX_20X, PRO])
    expect(budget(await note(account))).toStrictEqual([]);
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
  // The reason lists what is allowed, without Fable, and names the plan.
  expect(out.reason).toContain("claude-sonnet-5-5");
  expect(out.reason).not.toMatch(/fable/);
  expect(out.reason).toContain("Claude Pro");
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

test("readConfig reads a ~/.claude.json over 4 MiB", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-big-"));
  fs.writeFileSync(
    path.join(dir, ".claude.json"),
    JSON.stringify({
      history: "x".repeat(5 * 1024 * 1024),
      oauthAccount: PRO,
    }),
  );
  const account = await readAccount(ioWith({ CLAUDE_CONFIG_DIR: dir }));
  fs.rmSync(dir, { recursive: true, force: true });
  expect(account).toEqual(PRO);
});
