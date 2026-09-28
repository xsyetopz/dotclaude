// dotclaude's status lines: what each part shows at dotclaude's bounds, the
// width fit, the subagent rows, and the stub that the user settings run.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters as plain } from "node:util";
import {
  MAIN_CONTEXT_TOKENS,
  STALE_CACHE_CONTEXT_TOKENS,
  SUBAGENT_CONTEXT_TOKENS,
} from "../../hooks/lib/_budget.mjs";
import {
  cachePart,
  contextPart,
  limitPart,
  renderMain,
  renderTask,
  shortModel,
  stubText,
  syncStatusLine,
  syncSubagentStatusLine,
  width,
} from "../../hooks/lib/_status-line.mjs";
import { HOOKS } from "../support/hooks.mjs";

const NOW = Date.parse("2026-09-28T12:00:00");
const sec = (ms) => Math.floor(ms / 1000);
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

test("model IDs shorten to name and version", () => {
  expect(shortModel("claude-opus-5-5")).toBe("Opus 5.5");
  expect(shortModel("claude-sonnet-5")).toBe("Sonnet 5");
  expect(shortModel("claude-fable-5-1[1m]")).toBe("Fable 5.1");
  expect(shortModel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  expect(shortModel("gpt-x")).toBe("gpt-x");
});

test("context is measured against the budget, with a handoff mark past it", () => {
  const low = contextPart(40_000, MAIN_CONTEXT_TOKENS);
  expect(plain(low)).toBe("40k/200k ██░░░░░░");
  expect(low).not.toContain(YELLOW);
  expect(contextPart(0.8 * MAIN_CONTEXT_TOKENS, MAIN_CONTEXT_TOKENS)).toContain(
    YELLOW,
  );
  const over = contextPart(MAIN_CONTEXT_TOKENS + 10_000, MAIN_CONTEXT_TOKENS);
  expect(plain(over)).toBe("210k/200k ████████ handoff");
  expect(over).toContain(`${RED}handoff`);
});

test("the cache part shows the expiry while warm and the re-read cost when cold", () => {
  const warm = {
    caching_observed: true,
    warm: true,
    expires_at: sec(NOW + 40 * 60_000),
    hit_ratio: 0.93,
  };
  expect(plain(cachePart(warm, NOW))).toBe("cache till 12:40 93%");
  expect(cachePart({ ...warm, hit_ratio: 0.6 }, NOW)).toContain(`${YELLOW}60%`);
  const cold = {
    caching_observed: true,
    warm: false,
    expires_at: null,
    hit_ratio: 0.9,
    recache_tokens_if_cold: STALE_CACHE_CONTEXT_TOKENS + 20_000,
  };
  expect(plain(cachePart(cold, NOW))).toBe("cache cold, 120k to re-read 90%");
  expect(cachePart(cold, NOW)).toContain(RED);
  expect(
    plain(cachePart({ ...cold, recache_tokens_if_cold: 30_000 }, NOW)),
  ).toBe("cache cold 90%");
  // An expiry in the past counts as cold even if `warm` is stale.
  expect(
    plain(cachePart({ ...warm, expires_at: sec(NOW - 1000) }, NOW)),
  ).toStartWith("cache cold");
  expect(cachePart({ caching_observed: false }, NOW)).toBe(null);
});

test("a usage limit shows its reset only from the first usage level", () => {
  const reset = sec(NOW + 90 * 60_000);
  expect(
    plain(limitPart("5h", { used_percentage: 40, resets_at: reset }, NOW)),
  ).toBe("5h 40%");
  const high = limitPart(
    "5h",
    { used_percentage: 91.2, resets_at: reset },
    NOW,
  );
  expect(plain(high)).toBe("5h 91% ↻13:30");
  expect(high).toContain(`${RED}91%`);
  expect(limitPart("7d", undefined, NOW)).toBe(null);
});

const DATA = {
  workspace: { current_dir: "/work/dotclaude" },
  model: { id: "claude-opus-5-5", display_name: "Opus" },
  effort: { level: "medium" },
  context_window: { total_input_tokens: 87_000 },
  prompt_cache: {
    caching_observed: true,
    warm: true,
    expires_at: sec(NOW + 40 * 60_000),
    hit_ratio: 0.93,
  },
  rate_limits: {
    five_hour: { used_percentage: 23 },
    seven_day: { used_percentage: 41 },
  },
  cost: { total_cost_usd: 3.21 },
  pr: { number: 42, url: "https://github.com/o/r/pull/42" },
};
const GIT = { branch: "main", dirty: 3, ahead: 1, behind: 0 };

test("the main line joins every part, and shows cost only without plan limits", () => {
  const line = renderMain(DATA, { columns: 200, now: NOW, git: GIT });
  expect(plain(line)).toBe(
    "dotclaude · main ±3 ↑1 · Opus 5.5 medium · 87k/200k ███░░░░░ · cache till 12:40 93% · 5h 23% · 7d 41% · #42",
  );
  expect(line).toContain("\x1b]8;;https://github.com/o/r/pull/42\x07");
  const api = renderMain(
    { ...DATA, rate_limits: undefined },
    { columns: 200, now: NOW },
  );
  expect(plain(api)).toContain("$3.21");
});

test("a narrow terminal drops the lowest-priority parts first", () => {
  const line = renderMain(DATA, { columns: 60, now: NOW, git: GIT });
  expect(width(line)).toBeLessThanOrEqual(60);
  expect(plain(line)).toContain("87k/200k");
  expect(plain(line)).toContain("Opus 5.5");
  expect(plain(line)).not.toContain("#42");
  expect(plain(line)).not.toContain("7d");
});

test("a subagent row measures its context against the subagent budget", () => {
  const row = renderTask(
    {
      name: "implementer",
      model: "claude-sonnet-5",
      effort: "medium",
      tokenCount: SUBAGENT_CONTEXT_TOKENS + 5_000,
      startTime: NOW - 7 * 60_000,
      description: "Add the stale cache notice and its tests",
    },
    { columns: 200, now: NOW },
  );
  expect(plain(row)).toBe(
    "implementer · Sonnet 5 medium · 155k/150k ████████ handoff · 7m · Add the stale cache notice and its tests",
  );
  const narrow = renderTask(
    { name: "x", description: "a long description ".repeat(10) },
    { columns: 40, now: NOW },
  );
  expect(width(narrow)).toBeLessThanOrEqual(40);
  expect(plain(narrow)).toEndWith("…");
});

const bun = (script, input, env = {}) =>
  spawnSync("bun", [script], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, COLUMNS: "200", ...env },
  });

test("the entry points print a line and one JSON row per task", () => {
  const main = bun(path.join(HOOKS, "status-line/main.mjs"), DATA);
  expect(plain(main.stdout)).toContain("Opus 5.5 medium");
  const rows = bun(path.join(HOOKS, "status-line/subagents.mjs"), {
    columns: 80,
    tasks: [{ id: "t1", name: "test-runner", tokenCount: 20_000 }, {}],
  })
    .stdout.trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(rows.map((r) => r.id)).toEqual(["t1"]);
  expect(plain(rows[0].content)).toStartWith("test-runner · 20k/150k");
});

test("a row without a name takes the agent type from its meta file", () => {
  // Claude Code 2.1.283 sends `type: "local_agent"` and no agent type.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statusline-"));
  const transcript = path.join(dir, "s1.jsonl");
  fs.mkdirSync(path.join(dir, "s1", "subagents"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "s1", "subagents", "agent-a1.meta.json"),
    JSON.stringify({ agentType: "dotclaude:test-runner" }),
  );
  const rows = bun(path.join(HOOKS, "status-line/subagents.mjs"), {
    transcript_path: transcript,
    columns: 80,
    tasks: [
      { id: "a1", type: "local_agent", tokenCount: 5_000 },
      { id: "a2", type: "local_agent" },
    ],
  })
    .stdout.trim()
    .split("\n")
    .map((l) => plain(JSON.parse(l).content));
  expect(rows[0]).toStartWith("test-runner · 5k/150k");
  expect(rows[1]).toStartWith("agent");
  fs.rmSync(dir, { recursive: true });
});

test("session start re-points an installed stub and leaves a missing one missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statusline-"));
  const stub = path.join(dir, "statusline.mjs");
  expect(syncStatusLine(stub)).toBe(false);
  expect(fs.existsSync(stub)).toBe(false);
  fs.writeFileSync(stub, stubText("/old/version/hooks/status-line/main.mjs"));
  expect(syncStatusLine(stub)).toBe(true);
  expect(fs.readFileSync(stub, "utf8")).toBe(stubText());
  expect(syncStatusLine(stub)).toBe(false);
  expect(plain(bun(stub, DATA).stdout)).toContain("Opus 5.5 medium");
});

test("the plugin's subagentStatusLine runs the stub that session start writes", () => {
  // Claude Code leaves ${CLAUDE_PLUGIN_ROOT} empty in this command, so the
  // command must not use it.
  const { command } = JSON.parse(
    fs.readFileSync(path.join(HOOKS, "..", "settings.json"), "utf8"),
  ).subagentStatusLine;
  expect(command).not.toContain("CLAUDE_PLUGIN_ROOT");
  const config = fs.mkdtempSync(path.join(os.tmpdir(), "statusline-"));
  const stub = path.join(config, "dotclaude", "subagent-statusline.mjs");
  expect(syncSubagentStatusLine(stub)).toBe(true);
  expect(syncSubagentStatusLine(stub)).toBe(false);
  const out = spawnSync("sh", ["-c", command], {
    input: JSON.stringify({
      columns: 100,
      tasks: [
        { id: "a1", name: "", model: "claude-sonnet-5", tokenCount: 5000 },
      ],
    }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: config },
    encoding: "utf8",
  });
  expect(JSON.parse(out.stdout).id).toBe("a1");
  fs.rmSync(config, { recursive: true });
});
