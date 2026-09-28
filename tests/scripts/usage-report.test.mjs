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
