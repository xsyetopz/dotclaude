#!/usr/bin/env bun
// Where Claude Code usage went, from the session transcripts under
// ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects).
//
//   bun scripts/usage-report.mjs [--days 7] [--root DIR] [--json]
//
// Costs are API-equivalent dollars at list prices: a subscription does not
// bill them, but its limits track the same token mix, so the shares show
// what spends a plan's limits. Reports the share by agent type, the share of
// calls whose context is past 150k tokens, and the cost of full cache
// rewrites (a write over 30k tokens that is larger than the read), and the
// main-conversation turns that background agents started.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// $ per million tokens: input, output, cache read, 5m write, 1h write.
const PRICES = {
  fable: [10, 50, 0.25, 12.5, 20],
  opus: [4, 20, 0.2, 5, 8],
  sonnet: [2, 10, 0.2, 2.5, 4],
  haiku: [1, 5, 0.1, 1.25, 2],
};

export function callCost(model, u) {
  const family = Object.keys(PRICES).find((f) => String(model).includes(f));
  if (!family) return { total: 0, write: 0, context: 0 };
  const [pi, po, pr, p5, p1] = PRICES[family];
  const cc = u.cache_creation;
  const w1 = cc?.ephemeral_1h_input_tokens ?? 0;
  const w5 = cc
    ? (cc.ephemeral_5m_input_tokens ?? 0)
    : (u.cache_creation_input_tokens ?? 0);
  const read = u.cache_read_input_tokens ?? 0;
  const input = u.input_tokens ?? 0;
  const write = (w5 * p5 + w1 * p1) / 1e6;
  return {
    total: (input * pi + (u.output_tokens ?? 0) * po + read * pr) / 1e6 + write,
    write,
    context: input + read + (u.cache_creation_input_tokens ?? 0),
    rewrite:
      (u.cache_creation_input_tokens ?? 0) > 30_000 &&
      (u.cache_creation_input_tokens ?? 0) > read,
  };
}

function agentType(file) {
  if (!file.includes(`${path.sep}subagents${path.sep}`)) return "main";
  try {
    const meta = JSON.parse(
      fs.readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8"),
    );
    return meta.agentType || "subagent";
  } catch {
    return "subagent";
  }
}

export function report(root, since) {
  const byAgent = {};
  let total = 0;
  let over150k = 0;
  let rewrites = 0;
  // Main-conversation turns by what started them: a background agent's
  // report or task notification, or anything else (mostly the user).
  const turns = { wake: 0, other: 0 };
  let wakeCost = 0;
  const files = fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(root, f))
    .filter((f) => fs.statSync(f).mtimeMs >= since.getTime());
  for (const file of files) {
    const type = agentType(file);
    const seen = new Set();
    let wake = false;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (type === "main" && entry.type === "user") {
        const content = entry.message?.content;
        const toolResult =
          Array.isArray(content) &&
          content.some((b) => b.type === "tool_result");
        // Meta reminders without an origin continue the current turn.
        if (!toolResult && !(entry.isMeta && !entry.origin)) {
          const kind = entry.origin?.kind;
          wake = kind === "peer" || kind === "task-notification";
          if (new Date(entry.timestamp) >= since)
            turns[wake ? "wake" : "other"] += 1;
        }
        continue;
      }
      const m = entry.message;
      if (entry.type !== "assistant" || !m?.usage) continue;
      if (new Date(entry.timestamp) < since || seen.has(m.id)) continue;
      seen.add(m.id);
      const c = callCost(m.model, m.usage);
      total += c.total;
      byAgent[type] = (byAgent[type] ?? 0) + c.total;
      if (c.context > 150_000) over150k += c.total;
      if (c.rewrite) rewrites += c.write;
      if (type === "main" && wake) wakeCost += c.total;
    }
  }
  const share = (x) => (total ? Math.round((1000 * x) / total) / 10 : 0);
  return {
    total: Math.round(total * 100) / 100,
    byAgent: Object.entries(byAgent)
      .sort((a, b) => b[1] - a[1])
      .map(([type, cost]) => ({
        type,
        cost: Math.round(cost * 100) / 100,
        share: share(cost),
      })),
    over150kShare: share(over150k),
    rewriteShare: share(rewrites),
    mainTurns: turns,
    wakeShare: share(wakeCost),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const days = Number(opt("--days", "7"));
  const root = opt(
    "--root",
    path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
      "projects",
    ),
  );
  const r = report(root, new Date(Date.now() - days * 86_400_000));
  if (args.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`Last ${days} days: $${r.total} API-equivalent`);
    for (const a of r.byAgent.slice(0, 10))
      console.log(
        `  ${a.type.padEnd(32)} $${a.cost.toFixed(2).padStart(9)}  ${a.share}%`,
      );
    console.log(`Calls with context past 150k: ${r.over150kShare}% of cost`);
    console.log(`Full cache rewrites: ${r.rewriteShare}% of cost`);
    console.log(
      `Main turns started by background agents: ${r.mainTurns.wake} of ${r.mainTurns.wake + r.mainTurns.other}, ${r.wakeShare}% of cost`,
    );
  }
}
