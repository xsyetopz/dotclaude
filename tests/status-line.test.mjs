import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTO_COMPACT_TOKENS,
  STATUS_CACHE_MS,
  STATUS_REFRESH_SECONDS,
  USAGE_LEVELS,
} from "../hooks/lib/_budget.mjs";
import { renderMain, renderTask } from "../status-line/shared.mjs";
import { cached, compactions, loopProgress } from "../status-line/sources.mjs";

const root = join(import.meta.dir, "..");
const strip = (text) => Bun.stripANSI(text);
const EVEN = 1_800_000_000_000; // second 1.8e9 is even: a blink "on" frame
const ODD = EVEN + 1000;
const main = (data, o = {}) => strip(renderMain(data, { now: EVEN, ...o }));
const rows = (data, o) => main(data, o).split("\n");
const sec = (offsetSec, now = EVEN) => now / 1000 + offsetSec;

function run(script, input) {
  const res = Bun.spawnSync(["bun", join(root, "status-line", script)], {
    stdin: Buffer.from(
      typeof input === "string" ? input : JSON.stringify(input),
    ),
    cwd: tmpdir(), // not a git folder, so no branch part
  });
  return strip(res.stdout.toString()).trimEnd();
}

const simple = {
  model: { id: "claude-opus-5-5" },
  effort: { level: "high" },
  context_window: { total_input_tokens: 87_000 },
  prompt_cache: { caching_observed: true, warm: true, expires_at: sec(2400) },
  rate_limits: {
    five_hour: { used_percentage: 82.4, resets_at: sec(3600) },
    seven_day: { used_percentage: 31, resets_at: sec(3 * 86_400) },
  },
};

test("the core row has model, context bar, cache expiry, and limits in order", () => {
  const [core] = rows(simple);
  expect(core.split(" · ")).toEqual([
    "Opus 5.5 high",
    "◧ ████░ 87k/117k",
    "◷ 40m",
    expect.stringMatching(/^5h ████░ {2}82% ↻\d/),
    expect.stringMatching(/^7d ██░░░ {2}31% ↻/),
  ]);
});

test("a cold cache and a missing window print without a throw", () => {
  const data = {
    model: { id: "claude-haiku-4-5-20251001" },
    context_window: { total_input_tokens: 5_000 },
    prompt_cache: {
      caching_observed: true,
      warm: false,
      recache_tokens_if_cold: 100_000,
    },
  };
  expect(main(data)).toBe("Haiku 4.5 · ◧ ░░░░░ 5k/117k · ◌ cold 100k");
  for (const input of [{}, "not json", "null"])
    expect(run("main.mjs", input)).toBe("");
  const bare = { model: {}, rate_limits: { five_hour: {} }, workspace: {} };
  expect(run("main.mjs", bare)).toBe("");
});

test("warns on effort that the rules do not allow for the model", () => {
  const warn = (id, level) => main({ model: { id }, effort: { level } });
  expect(warn("claude-sonnet-5-5", "high")).toContain("high ⚠");
  expect(warn("claude-sonnet-5-5", "medium")).not.toContain("⚠");
  expect(warn("claude-opus-5-5", "xhigh")).toContain("⚠");
  expect(warn("claude-opus-5-5", "high")).not.toContain("⚠");
  expect(warn("claude-haiku-4-5", "low")).toContain("⚠");
  expect(warn("claude-unknown-9-9", "max")).not.toContain("⚠");
});

test("colors every percentage by the same thresholds", () => {
  const [warn, high] = USAGE_LEVELS;
  const colors = (pct) => {
    const out = renderMain(
      {
        context_window: {
          total_input_tokens: (pct / 100) * AUTO_COMPACT_TOKENS,
        },
        rate_limits: { five_hour: { used_percentage: pct } },
      },
      { now: EVEN },
    );
    return new Set(
      out
        .split("\u001b[")
        .map((piece) => /^(3\d)m\s*(\d[\d%k/]*|█)/.exec(piece)?.[1])
        .filter(Boolean),
    );
  };
  expect(colors(warn - 1)).toEqual(new Set(["32"]));
  expect(colors(warn)).toEqual(new Set(["33"]));
  expect(colors(high)).toEqual(new Set(["31"]));
});

test("blinks one warning glyph for handoff, cache expiry, and a limit", () => {
  const cases = {
    "◧": () => ({
      context_window: { total_input_tokens: AUTO_COMPACT_TOKENS },
    }),
    "◷ 2m": (now) => ({
      prompt_cache: {
        caching_observed: true,
        warm: true,
        expires_at: sec(90, now),
      },
    }),
    "7d": () => ({ rate_limits: { seven_day: { used_percentage: 95 } } }),
  };
  for (const [part, make] of Object.entries(cases)) {
    const on = rows(make(EVEN), { now: EVEN })[0];
    const off = rows(make(ODD), { now: ODD })[0];
    expect(on).toStartWith("⚠ ");
    expect(on).toContain(part);
    expect(off).not.toContain("⚠");
    expect(off.length).toBe(on.length);
  }
  expect(rows(simple)[0]).not.toContain("⚠");
  expect(STATUS_REFRESH_SECONDS).toBeLessThanOrEqual(1);
});

test("the place row has folder, branch, changes, worktree, PR, loop, and session", () => {
  const data = {
    workspace: {
      project_dir: "/work/app",
      current_dir: "/work/app/src",
      added_dirs: ["/x"],
    },
    worktree: { name: "feat" },
    pr: { number: 42, kind: "pr", review_state: "approved" },
    agent: { name: "rev" },
    vim: { mode: "NORMAL" },
    session_name: "fix it",
  };
  const git = { branch: "main", dirty: 3, ahead: 1, behind: 2 };
  const loop = { done: 2, total: 7 };
  expect(rows(data, { git, loop })[0].split(" · ")).toEqual([
    "app/src +1",
    "⎇ main ±3 ↑1 ↓2",
    "⊞ feat",
    "#42",
    "loop 2/7",
    "@rev",
    "NORMAL",
    "fix it",
  ]);
});

test("the folder reads the same with either path separator", () => {
  for (const [project_dir, current_dir] of [
    ["C:\\work\\app", "C:\\work\\app\\src\\lib"],
    ["C:/work/app", "C:/work/app/src/lib"],
  ])
    expect(rows({ workspace: { project_dir, current_dir } })[0]).toBe(
      "app/src/lib",
    );
  expect(rows({ workspace: { current_dir: "C:\\work\\app\\" } })[0]).toBe(
    "app",
  );
});

test("the detail row has hit ratio, misses, pace, cost, lines, and time", () => {
  const data = {
    ...simple,
    prompt_cache: {
      ...simple.prompt_cache,
      hit_ratio: 0.93,
      misses: 3,
      miss_causes: { ttl_expired_1h: 1, tools_changed: 2 },
      last_miss_cause: { causes: ["tools_changed"] },
    },
    rate_limits: {
      // 60% of the window is gone, so 82% used is a deficit of 22 points.
      five_hour: { used_percentage: 82, resets_at: sec(2 * 3600) },
      seven_day: { used_percentage: 10, resets_at: sec(86_400) },
    },
    fast_mode: true,
    cost: {
      total_cost_usd: 1.5,
      total_lines_added: 156,
      total_lines_removed: 23,
      total_duration_ms: 65 * 60_000,
    },
  };
  const [core, detail] = rows(data);
  expect(core).toContain("Opus 5.5 high FAST");
  expect(detail.split(" · ")).toEqual([
    "◷ 93% ✘2 tools",
    expect.stringMatching(/^5h ▲22%→\d/),
    "7d ▼d+%".length ? expect.stringMatching(/^7d ▼\d+%$/) : "",
    "+156 -23",
    "1h5m",
  ]);
  // A subscriber sees limits, and anyone else sees the cost.
  expect(rows({ ...data, rate_limits: undefined }).at(-1)).toContain("$1.50");
});

test("the hit ratio reads as better when higher, on the same scale", () => {
  const color = (hit) => {
    const out = renderMain(
      { prompt_cache: { caching_observed: true, hit_ratio: hit } },
      { now: EVEN },
    );
    return out
      .split("\u001b[")
      .find((piece) => piece.includes("%"))
      ?.slice(0, 2);
  };
  expect(color(0.99)).toBe("32");
  expect(color(0.05)).toBe("31");
});

test("compactions count `⇊` after the context, and the usage copy fills a window", () => {
  const [core] = rows(simple, { compactions: 2 });
  expect(core).toContain("87k/117k ⇊2");
  const data = { rate_limits: { five_hour: { used_percentage: 5 } } };
  const usage = { seven_day: { used_percentage: 40, resets_at: sec(86_400) } };
  expect(main(data, { usage })).toMatch(/5h .* 5% .*· 7d .* 40% /);
});

test("wraps past the columns and drops the lowest priority part first", () => {
  const data = {
    ...simple,
    workspace: { current_dir: "/a" },
    session_name: "name",
  };
  const narrow = rows(data, { columns: 40 });
  expect(narrow.length).toBeLessThanOrEqual(3);
  expect(narrow.join("\n")).toContain("87k/117k");
  expect(narrow.join("\n")).not.toContain("name");
});

test("the pace of a window past the first level stays when parts drop", () => {
  const data = {
    model: { id: "claude-opus-5-5" },
    context_window: { total_input_tokens: 50_000 },
    rate_limits: {
      five_hour: { used_percentage: 9, resets_at: sec(3600) },
      // 83% of the window is gone, so 99% used is a deficit of 16 points.
      seven_day: { used_percentage: 99, resets_at: sec(1.2 * 86_400) },
    },
    workspace: { current_dir: "/a" },
    cost: { total_duration_ms: 600_000 },
  };
  expect(main(data, { columns: 80 })).toMatch(/7d ▲16%→/);
});

test("sources: `cached` reuses a result for the cache time, and counts compactions", () => {
  const key = `test ${Math.random()}`;
  let calls = 0;
  const compute = () => ++calls;
  expect(cached(key, compute, EVEN)).toBe(1);
  expect(cached(key, compute, EVEN + STATUS_CACHE_MS - 1)).toBe(1);
  expect(cached(key, compute, EVEN + STATUS_CACHE_MS)).toBe(2);

  const dir = mkdtempSync(join(tmpdir(), "status-"));
  const transcript = join(dir, "t.jsonl");
  const boundary = '{"type":"system","subtype":"compact_boundary"}\n';
  const quoted = '{"text":"\\"subtype\\":\\"compact_boundary\\""}\n';
  writeFileSync(transcript, boundary + quoted + boundary);
  expect(compactions(transcript, EVEN)).toBe(2);
  writeFileSync(transcript, boundary + quoted + boundary + boundary);
  expect(compactions(transcript, EVEN + 1)).toBe(2); // reused
  expect(compactions(transcript, EVEN + STATUS_CACHE_MS)).toBe(3); // appended only
  expect(compactions("", EVEN)).toBe(0);

  const loop = join(dir, ".dotclaude", "loop");
  Bun.spawnSync(["mkdir", "-p", loop]);
  writeFileSync(
    join(loop, "slices.jsonl"),
    '{"id":1,"status":"merged"}\n{"id":2,"status":"pending"}\nnot json\n',
  );
  expect(loopProgress(dir)).toEqual({ done: 1, total: 2 });
  expect(loopProgress(join(dir, "none"))).toBeNull();
});

test("subagent rows give name, model, effort, context, time, and description", () => {
  const task = {
    name: "worker",
    model: "claude-haiku-4-5",
    effort: "low",
    tokenCount: 95_000,
    startTime: EVEN - 5 * 60_000,
    description: "Fix the failing test",
  };
  const row = (agentType, now) => strip(renderTask(task, agentType, { now }));
  expect(row(null, EVEN)).toBe(
    "worker Haiku 4.5 low ⚠ · ⚠ ◧ █████ 95k/100k · 5m · Fix the failing test",
  );
  expect(row(null, ODD)).toContain("  ◧ █████ 95k/100k");
  expect(row("reviewer", EVEN)).toContain("◧ ███░░ 95k/150k");
  expect(strip(renderTask({ id: "x" }, null))).toBe("agent");
});

test("the subagent command prints one JSON line per task with an id", () => {
  const out = run("subagents.mjs", {
    tasks: [
      { id: "a1", name: "worker", tokenCount: 62_000 },
      { name: "no-id" },
    ],
  })
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(out).toHaveLength(1);
  expect(out[0].id).toBe("a1");
  expect(strip(out[0].content)).toContain("62k/100k");
});
