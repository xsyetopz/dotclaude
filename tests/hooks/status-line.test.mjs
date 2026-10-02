// dotclaude's status lines: what each part shows at dotclaude's bounds, the
// width fit, the subagent rows, and the stub that the user settings run.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters as plain } from "node:util";
import {
  AUTO_COMPACT_TOKENS,
  COMPACTIONS_BEFORE_HANDOFF,
  CONTEXT_NOTE_TOKENS,
  k,
  MAIN_CONTEXT_TOKENS,
  STALE_CACHE_CONTEXT_TOKENS,
  SUBAGENT_CONTEXT_TOKENS,
} from "../../hooks/lib/_budget.mjs";
import {
  cachePart,
  contextPart,
  limitPart,
  mainContextPart,
  renderMain,
  renderTask,
  shortModel,
  statusLineSetting,
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
const GREEN = "\x1b[32m";

test("model IDs shorten to name and version", () => {
  expect(shortModel("claude-opus-5-5")).toBe("Opus 5.5");
  expect(shortModel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
  expect(shortModel("claude-fable-5-1[1m]")).toBe("Fable 5.1");
  expect(shortModel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  expect(shortModel("gpt-x")).toBe("gpt-x");
});

test("context is measured against the budget, with a handoff mark past it", () => {
  const low = contextPart(40_000, MAIN_CONTEXT_TOKENS);
  expect(plain(low)).toBe("40k/150k █░░░░");
  expect(low).not.toContain(YELLOW);
  expect(contextPart(0.8 * MAIN_CONTEXT_TOKENS, MAIN_CONTEXT_TOKENS)).toContain(
    YELLOW,
  );
  const over = contextPart(MAIN_CONTEXT_TOKENS + 10_000, MAIN_CONTEXT_TOKENS);
  expect(plain(over)).toBe("160k/150k █████ handoff");
  expect(over).toContain(`${RED}handoff`);
});

test("the main context is measured against the compaction point, with the compactions so far", () => {
  expect(plain(mainContextPart(40_000, 0))).toBe(
    `40k/${k(AUTO_COMPACT_TOKENS)} ██░░░`,
  );
  // Past the compaction point, Claude Code compacts, so no handoff mark.
  expect(plain(mainContextPart(AUTO_COMPACT_TOKENS + 3_000, 0))).toBe(
    `${k(AUTO_COMPACT_TOKENS + 3_000)}/${k(AUTO_COMPACT_TOKENS)} █████`,
  );
  const before = mainContextPart(CONTEXT_NOTE_TOKENS + 5_000, 1);
  expect(plain(before)).toEndWith(` ⇊1/${COMPACTIONS_BEFORE_HANDOFF}`);
  expect(before).not.toContain("handoff");
  // The handoff mark comes when the context note asks for a handoff.
  const early = mainContextPart(30_000, COMPACTIONS_BEFORE_HANDOFF);
  expect(early).not.toContain("handoff");
  const due = mainContextPart(CONTEXT_NOTE_TOKENS, COMPACTIONS_BEFORE_HANDOFF);
  expect(plain(due)).toEndWith(
    ` ⇊${COMPACTIONS_BEFORE_HANDOFF}/${COMPACTIONS_BEFORE_HANDOFF} handoff`,
  );
  expect(due).toContain(`${RED}handoff`);
});

test("the main line counts the compactions in its transcript", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statusline-"));
  const file = path.join(dir, "s.jsonl");
  const boundary = JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
  });
  fs.writeFileSync(file, `${boundary}\n${boundary}\n`);
  const line = renderMain(
    { ...DATA, transcript_path: file },
    { columns: 200, now: NOW, git: GIT },
  );
  expect(plain(line)).toContain(
    `87k/117k ████░ ⇊2/${COMPACTIONS_BEFORE_HANDOFF}`,
  );
  fs.rmSync(dir, { recursive: true });
});

test("the cache part shows the expiry while warm and the re-read cost when cold", () => {
  const warm = {
    caching_observed: true,
    warm: true,
    expires_at: sec(NOW + 40 * 60_000),
    hit_ratio: 0.93,
  };
  expect(plain(cachePart(warm, NOW))).toBe("◷ 40m 93%");
  // The minutes left round up, so a warm cache never shows 0m.
  const soon = { ...warm, expires_at: sec(NOW + 20_000) };
  expect(plain(cachePart(soon, NOW))).toBe("◷ 1m 93%");
  const long = { ...warm, expires_at: sec(NOW + 65 * 60_000) };
  expect(plain(cachePart(long, NOW))).toBe("◷ 1h5m 93%");
  expect(cachePart({ ...warm, hit_ratio: 0.6 }, NOW)).toContain(`${YELLOW}60%`);
  const cold = {
    caching_observed: true,
    warm: false,
    expires_at: null,
    hit_ratio: 0.9,
    recache_tokens_if_cold: STALE_CACHE_CONTEXT_TOKENS + 20_000,
  };
  expect(plain(cachePart(cold, NOW))).toBe("◌ cold 120k 90%");
  expect(cachePart(cold, NOW)).toContain(RED);
  expect(
    plain(cachePart({ ...cold, recache_tokens_if_cold: 30_000 }, NOW)),
  ).toBe("◌ cold 90%");
  // An expiry in the past counts as cold even if `warm` is stale.
  expect(
    plain(cachePart({ ...warm, expires_at: sec(NOW - 1000) }, NOW)),
  ).toStartWith("◌ cold");
  expect(cachePart({ caching_observed: false }, NOW)).toBe(null);
});

test("the cache part counts only misses that idle time did not cause", () => {
  const warm = {
    caching_observed: true,
    warm: true,
    expires_at: sec(NOW + 40 * 60_000),
    hit_ratio: 0.97,
  };
  const idle = {
    ...warm,
    misses: 1,
    last_miss_cause: { causes: ["ttl_expired_1h"] },
    miss_causes: { ttl_expired_1h: 1 },
  };
  expect(plain(cachePart(idle, NOW))).toBe("◷ 40m 97%");
  // The last miss came from idle time, so its cause does not name the others.
  const mixed = {
    ...warm,
    misses: 4,
    last_miss_cause: { causes: ["ttl_expired_5m"] },
    miss_causes: { tools_changed: 1, ttl_expired_5m: 2, ttl_expired_1h: 1 },
  };
  expect(plain(cachePart(mixed, NOW))).toBe("◷ 40m 97% ✗1");
  // A model switch starts a new cache, so its rebuild is expected. Claude
  // Code already keeps the first call and compactions out of `misses`.
  const model = {
    ...warm,
    misses: 1,
    last_miss_cause: { causes: ["model_changed", "effort_changed"] },
    miss_causes: { model_changed: 1, effort_changed: 1 },
  };
  expect(plain(cachePart(model, NOW))).toBe("◷ 40m 97%");
  const both = {
    ...model,
    misses: 3,
    miss_causes: { model_changed: 2, effort_changed: 1, tools_changed: 1 },
  };
  expect(plain(cachePart(both, NOW))).toBe("◷ 40m 97% ✗1");
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

test("a usage limit shows its pace as a deficit or a reserve", () => {
  const FIVE_H = 5 * 3600;
  // 90 minutes left of 5 hours: 70% of the window is gone.
  const reset = sec(NOW + 90 * 60_000);
  const ahead = limitPart(
    "5h",
    { used_percentage: 82, resets_at: reset },
    NOW,
    FIVE_H,
  );
  // A deficit: 82% used in 210 minutes runs out 46 minutes from now, at
  // 12:46, before the reset at 13:30.
  expect(plain(ahead)).toBe("5h 82% ▲12%→12:46 ↻13:30");
  expect(ahead).toContain(`${YELLOW}▲12%→12:46`);
  // A reserve: 40% used when 70% of the window is gone.
  const behind = { used_percentage: 40, resets_at: reset };
  const reserve = limitPart("5h", behind, NOW, FIVE_H);
  expect(plain(reserve)).toBe("5h 40% ▼30%");
  expect(reserve).toContain(`${GREEN}▼30%`);
  const even = { used_percentage: 70, resets_at: reset };
  expect(plain(limitPart("5h", even, NOW, FIVE_H))).toBe("5h 70%");
  const full = { used_percentage: 100, resets_at: reset };
  expect(plain(limitPart("5h", full, NOW, FIVE_H))).toBe("5h 100% ▲30% ↻13:30");
  // 6 days of 7 left: 14% of the week is gone. 30% in one day runs out 2.3 days from Monday noon.
  const week = { used_percentage: 30, resets_at: sec(NOW + 6 * 86_400_000) };
  expect(plain(limitPart("7d", week, NOW, 7 * 86_400))).toBe("7d 30% ▲16%→Wed");
  expect(plain(limitPart("5h", { used_percentage: 60 }, NOW, FIVE_H))).toBe(
    "5h 60%",
  );
  // Before 3% of the window is gone, the pace is noise: 10% of 5 hours
  // used after 6 minutes.
  const early = { used_percentage: 10, resets_at: sec(NOW + 294 * 60_000) };
  expect(plain(limitPart("5h", early, NOW, FIVE_H))).toBe("5h 10%");
  // A reset that is past or outside the window gives no pace.
  const past = { used_percentage: 60, resets_at: sec(NOW - 60_000) };
  expect(plain(limitPart("5h", past, NOW, FIVE_H))).toBe("5h 60%");
  const far = { used_percentage: 60, resets_at: sec(NOW + 6 * 3600_000) };
  expect(plain(limitPart("5h", far, NOW, FIVE_H))).toBe("5h 60%");
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "82"])
    expect(
      limitPart("5h", { used_percentage: bad, resets_at: reset }, NOW, FIVE_H),
    ).toBe(null);
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

test("the main line shows the place on one row and the usage on the next, with cost only without plan limits", () => {
  const line = renderMain(DATA, { columns: 200, now: NOW, git: GIT });
  expect(plain(line).split("\n")).toEqual([
    "dotclaude · ⎇ main ±3 ↑1 · #42",
    "Opus 5.5 medium · 87k/117k ████░ · ◷ 40m 93% · 5h 23% · 7d 41%",
  ]);
  expect(line).toContain("\x1b]8;;https://github.com/o/r/pull/42\x07");
  const api = renderMain(
    { ...DATA, rate_limits: undefined },
    { columns: 200, now: NOW },
  );
  expect(plain(api)).toContain("$3.21");
});

const FULL = {
  ...DATA,
  workspace: {
    // Native paths, as Claude Code sends them on each OS.
    current_dir: path.join("/work", "dotclaude", "hooks"),
    project_dir: path.join("/work", "dotclaude"),
    added_dirs: ["/work/skills", "/work/docs"],
    git_worktree: "feature-x",
  },
  session_name: "status line rows",
  agent: { name: "reviewer" },
  vim: { mode: "NORMAL" },
  prompt_cache: {
    ...DATA.prompt_cache,
    misses: 2,
    last_miss_cause: { causes: ["tools_changed"] },
  },
  rate_limits: {
    ...DATA.rate_limits,
    spend_limit: { used_percentage: 62.8 },
  },
  cost: {
    total_cost_usd: 3.21,
    total_duration_ms: 72 * 60_000,
    total_lines_added: 156,
    total_lines_removed: 23,
  },
};

test("the main line shows the session facts that advanced users check", () => {
  const text = plain(renderMain(FULL, { columns: 400, now: NOW, git: GIT }));
  expect(text.split("\n")).toEqual([
    "dotclaude/hooks +2 · ⊞ feature-x · ⎇ main ±3 ↑1 · #42 · @reviewer · NORMAL · status line rows",
    "Opus 5.5 medium · 87k/117k ████░ · ◷ 40m 93% ✗2 tools · 5h 23% · 7d 41% · spend 63% · +156 -23 · 1h12m",
  ]);
});

test("a narrow terminal wraps parts to new rows instead of cutting them off", () => {
  const rows = renderMain(FULL, { columns: 80, now: NOW, git: GIT }).split(
    "\n",
  );
  expect(rows.length).toBeLessThanOrEqual(3);
  for (const row of rows) expect(width(row)).toBeLessThanOrEqual(80);
  const text = plain(rows.join("\n"));
  for (const part of ["87k/117k", "Opus 5.5", "5h 23%", "◷ 40m 93%"])
    expect(text).toContain(part);
});

test("past three rows the lowest-priority parts go first", () => {
  const rows = renderMain(FULL, { columns: 30, now: NOW, git: GIT }).split(
    "\n",
  );
  expect(rows).toHaveLength(3);
  const text = plain(rows.join("\n"));
  expect(text).toContain("87k/117k");
  expect(text).not.toContain("1h12m");
  expect(text).not.toContain("status line rows");
  expect(text).not.toContain("5h");
  const high = {
    ...FULL,
    rate_limits: { five_hour: { used_percentage: 81 } },
  };
  const kept = renderMain(high, { columns: 30, now: NOW, git: GIT });
  expect(plain(kept)).toContain("5h 81%");
});

test("a subagent row measures its context against the subagent budget", () => {
  const row = renderTask(
    {
      name: "implementer",
      model: "claude-sonnet-5-5",
      effort: "medium",
      tokenCount: SUBAGENT_CONTEXT_TOKENS + 5_000,
      startTime: NOW - 7 * 60_000,
      description: "Add the stale cache notice and its tests",
    },
    { columns: 200, now: NOW },
  );
  expect(plain(row)).toBe(
    "implementer · Sonnet 5.5 medium · 105k/100k █████ handoff · 7m · Add the stale cache notice and its tests",
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
    tasks: [
      { id: "t1", name: "test-runner", tokenCount: 20_000 },
      {},
      { id: "t2", name: "reviewer", tokenCount: 120_000 },
    ],
  })
    .stdout.trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(rows.map((r) => r.id)).toEqual(["t1", "t2"]);
  expect(plain(rows[0].content)).toStartWith("test-runner · 20k/100k");
  expect(plain(rows[1].content)).toStartWith("reviewer · 120k/150k");
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
  expect(rows[0]).toStartWith("test-runner · 5k/100k");
  expect(rows[1]).toStartWith("agent");
  fs.rmSync(dir, { recursive: true });
});

test("the statusLine setting refreshes at least once a minute, matching the displayed fields' resolution", () => {
  const setting = statusLineSetting("/x/statusline.mjs");
  expect(setting.refreshInterval).toBeGreaterThanOrEqual(1);
  expect(setting.refreshInterval).toBeLessThanOrEqual(60);
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
        { id: "a1", name: "", model: "claude-sonnet-5-5", tokenCount: 5000 },
      ],
    }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: config },
    encoding: "utf8",
  });
  expect(JSON.parse(out.stdout).id).toBe("a1");
  fs.rmSync(config, { recursive: true });
});
