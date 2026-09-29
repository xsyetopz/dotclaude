// usage-report: cost by agent type, large-context share, rewrite share, and
// cache hit rate.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { report } from "../../scripts/usage-report.mjs";

const call = (id, usage, model = "claude-opus-5-5") =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-09-27T10:00:00.000Z",
    message: { id, model, usage },
  });

test("costs split by agent, context past 150k, full rewrites, and cache hits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-report-"));
  const sub = path.join(root, "proj", "s1", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  // Main: one 1M-token cache read ($0.20), repeated in a streamed duplicate.
  const big = call("m1", { cache_read_input_tokens: 1_000_000 });
  // The main call answers a background agent's task notification.
  const wake = JSON.stringify({
    type: "user",
    isMeta: true,
    origin: { kind: "task-notification" },
    timestamp: "2026-09-27T09:59:00.000Z",
    message: { content: "done" },
  });
  const typed = JSON.stringify({
    type: "user",
    timestamp: "2026-09-27T09:58:00.000Z",
    message: { content: "go" },
  });
  fs.writeFileSync(
    path.join(root, "proj", "s1.jsonl"),
    `${typed}\n${wake}\n${big}\n${big}\n`,
  );
  // Implementer: a 100k 5m cache write that rewrites the prefix ($0.50).
  fs.writeFileSync(
    path.join(sub, "agent-a1.jsonl"),
    call("a1", {
      cache_creation_input_tokens: 100_000,
      cache_creation: { ephemeral_5m_input_tokens: 100_000 },
      cache_read_input_tokens: 10_000,
    }),
  );
  fs.writeFileSync(
    path.join(sub, "agent-a1.meta.json"),
    JSON.stringify({ agentType: "dotclaude:implementer" }),
  );
  const r = report(root, new Date("2026-09-20"));
  expect(r.total).toBeCloseTo(0.702, 2);
  expect(r.byAgent.map((a) => a.type)).toEqual([
    "dotclaude:implementer",
    "main",
  ]);
  expect(r.over150kShare).toBeCloseTo(28.5, 0);
  expect(r.rewriteShare).toBeCloseTo(71.2, 0);
  expect(r.mainTurns).toEqual({ wake: 1, other: 1 });
  expect(r.wakeShare).toBeCloseTo(28.5, 0);
  // 1.01M of 1.11M input tokens were cache reads; the main call read all.
  expect(r.cacheHitRate).toEqual({ all: 91, main: 100 });
  expect(report(root, new Date("2026-09-28")).total).toBe(0);
});

test("advisor calls in `usage.iterations` count toward the cost", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-report-"));
  fs.mkdirSync(path.join(root, "proj"), { recursive: true });
  // The call's own usage leaves the advisor out: $0.02 of reads, then an
  // Opus advisor call that reads 100k tokens uncached ($0.40).
  fs.writeFileSync(
    path.join(root, "proj", "s1.jsonl"),
    call("m1", {
      cache_read_input_tokens: 100_000,
      iterations: [
        { type: "message", cache_read_input_tokens: 50_000 },
        {
          type: "advisor_message",
          model: "claude-opus-5-5",
          input_tokens: 100_000,
          cache_read_input_tokens: 0,
        },
        { type: "message", cache_read_input_tokens: 50_000 },
      ],
    }),
  );
  const r = report(root, new Date("2026-09-20"));
  expect(r.total).toBeCloseTo(0.42, 2);
  expect(r.advisor.calls).toBe(1);
  expect(r.advisor.share).toBeCloseTo(95.2, 0);
});

test("first warm call after a prompt, split by hook context in history", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-report-"));
  fs.mkdirSync(path.join(root, "p"));
  const at = (min) => new Date(Date.UTC(2026, 8, 27, 10, min)).toISOString();
  const prompt = (min) =>
    JSON.stringify({
      type: "user",
      timestamp: at(min),
      message: { content: "go" },
    });
  const use = (id, min, write, read) =>
    JSON.stringify({
      type: "assistant",
      timestamp: at(min),
      message: {
        id,
        model: "claude-opus-5-5",
        usage: {
          cache_creation_input_tokens: write,
          cache_read_input_tokens: read,
        },
      },
    });
  const hookContext = (event) =>
    JSON.stringify({
      type: "attachment",
      timestamp: at(0),
      attachment: { type: "hook_additional_context", hookEvent: event },
    });
  fs.writeFileSync(
    path.join(root, "p", "s.jsonl"),
    [
      hookContext("SessionStart"),
      prompt(0),
      use("a", 0, 50_000, 0), // cold: no earlier call
      use("b", 1, 1_000, 49_000), // not the first call after a prompt
      prompt(2),
      use("c", 2, 2_000, 48_000), // warm, no tool-hook context yet
      hookContext("PostToolUse"),
      prompt(3),
      use("d", 3, 40_000, 10_000), // warm, with hook context
      prompt(30),
      use("e", 30, 60_000, 0), // cold: the cache expired
    ].join("\n"),
  );
  const r = report(root, new Date("2026-09-20")).firstCallAfterPrompt;
  expect(r.without).toEqual({ calls: 1, avgWrite: 2_000, writeShare: 4 });
  expect(r.with).toEqual({ calls: 1, avgWrite: 40_000, writeShare: 80 });
});

test("turn cap: runs that reach the report reserve, and their brief size", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-report-"));
  const sub = path.join(root, "p", "s1", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  const run = (id, type, brief, calls) => {
    const lines = [
      JSON.stringify({ type: "user", message: { content: brief } }),
      ...Array.from({ length: calls }, (_, i) => call(`${id}-${i}`, {})),
    ];
    fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), lines.join("\n"));
    fs.writeFileSync(
      path.join(sub, `agent-${id}.meta.json`),
      JSON.stringify({ agentType: type }),
    );
  };
  // The implementer limit is 80, and tool calls stop with 4 left.
  run(
    "a1",
    "dotclaude:implementer",
    "Add the flag.\n1. Parse it in `src/cli.ts`.\n2. Use it in src/run.ts.\n3. Test it in tests/cli.test.ts.",
    76,
  );
  run(
    "a2",
    "dotclaude:implementer",
    "Fix the typo in README.md, e.g. `teh`.",
    75,
  );
  // A type without `maxTurns` in a dotclaude file does not count.
  run("a3", "Explore", "Find the parser.", 90);
  const r = report(root, new Date("2026-09-20")).turnCap;
  expect(r.runs).toBe(2);
  expect(r.capped).toEqual([
    { type: "dotclaude:implementer", runs: 1, files: 3, items: 3 },
  ]);
  expect(r.other).toEqual([
    { type: "dotclaude:implementer", runs: 1, files: 1, items: 0 },
  ]);
});
