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
// rewrites (a write over 30k tokens that is larger than the read), the
// main-conversation turns that background agents started, the advisor's
// share, and the prompt cache hit rate (cache reads over all input tokens).
// An advisor call is an `advisor_message` entry in the call's
// `usage.iterations`, and the call's own token counts leave it out.
// For dotclaude agents with a turn limit, it compares the briefs of the runs
// that reached the report reserve with the briefs of the other runs.
// A full rewrite is expected on the first call of a transcript, on the first
// call after a compaction, and after a model switch, because each one starts
// a new cache prefix. The report counts those apart from the rewrites that
// nothing explains.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { definition, reserve, turnsUsed } from "../hooks/lib/_agents.mjs";

// $ per million tokens: input, output, cache read, 5m write, 1h write.
const PRICES = {
  fable: [10, 50, 0.25, 12.5, 20],
  opus: [4, 20, 0.2, 5, 8],
  sonnet: [2, 10, 0.2, 2.5, 4],
  haiku: [1, 5, 0.1, 1.25, 2],
};

export function callCost(model, u) {
  const family = Object.keys(PRICES).find((f) => String(model).includes(f));
  if (!family) return { total: 0, write: 0, context: 0, read: 0 };
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
    read,
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

// A source or config file that a brief names, with or without a directory.
const FILE =
  /(?:[\w.@-]+\/)*[\w.@-]+\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|md|json|jsonc|yaml|yml|toml|sh|sql|css|scss|html|vue|svelte)\b/g;
// A bulleted or numbered line: one item of work, a constraint, or a check.
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s/gm;

function briefSize(file) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user") continue;
    const c = entry.message?.content;
    const text = (
      typeof c === "string"
        ? c
        : (Array.isArray(c) ? c : []).map((b) => b.text ?? "").join("\n")
    ).replace(/\w+:\/\/\S+/g, "");
    return {
      files: new Set(text.match(FILE) ?? []).size,
      items: (text.match(ITEM) ?? []).length,
    };
  }
  return { files: 0, items: 0 };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

/** Per agent type: runs, and the median files and list items in the brief. */
function briefStats(runs) {
  const byType = Map.groupBy(runs, (r) => r.type);
  return [...byType]
    .map(([type, rs]) => ({
      type,
      runs: rs.length,
      files: median(rs.map((r) => r.files)),
      items: median(rs.map((r) => r.items)),
    }))
    .sort((a, b) => b.runs - a.runs);
}

export function report(root, since) {
  const byAgent = {};
  let total = 0;
  let over150k = 0;
  let rewrites = 0;
  let expectedCost = 0;
  const expected = { first: 0, compaction: 0, model: 0 };
  // Main-conversation turns by what started them: a background agent's
  // report or task notification, or anything else (mostly the user).
  const turns = { wake: 0, other: 0 };
  let wakeCost = 0;
  const advisor = { calls: 0, cost: 0 };
  // Input tokens and cache reads, for all calls and for the main conversation.
  const cache = { all: [0, 0], main: [0, 0] };
  // Issue #83913: the first call after a prompt, while the 5-minute cache is
  // still warm, split by whether tool or prompt hook `additionalContext` is
  // in the history. [calls, cache writes, context] per bucket.
  const first = { with: [0, 0, 0], without: [0, 0, 0] };
  // dotclaude agent runs with a turn limit, and whether each one reached
  // the reserve where tool calls stop.
  const limited = [];
  const files = fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(root, f))
    .filter((f) => fs.statSync(f).mtimeMs >= since.getTime());
  for (const file of files) {
    const type = agentType(file);
    const limit = type === "main" ? null : definition(type)?.maxTurns;
    if (limit)
      limited.push({
        type,
        capped: turnsUsed(file) >= limit - reserve(limit),
        ...briefSize(file),
      });
    const seen = new Set();
    let wake = false;
    let hookContext = false;
    let firstPending = false;
    let lastCallAt = null;
    let lastModel = null;
    let compacted = false;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        entry.type === "attachment" &&
        entry.attachment?.type === "hook_additional_context" &&
        entry.attachment.hookEvent !== "SessionStart"
      )
        hookContext = true;
      if (entry.type === "system" && entry.subtype === "compact_boundary")
        compacted = true;
      if (type === "main" && entry.type === "user") {
        const content = entry.message?.content;
        const toolResult =
          Array.isArray(content) &&
          content.some((b) => b.type === "tool_result");
        // Meta reminders without an origin continue the current turn.
        if (!toolResult && !(entry.isMeta && !entry.origin)) {
          const kind = entry.origin?.kind;
          wake = kind === "peer" || kind === "task-notification";
          firstPending = true;
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
      const at = Date.parse(entry.timestamp);
      if (firstPending && lastCallAt !== null && at - lastCallAt < 300_000) {
        const b = first[hookContext ? "with" : "without"];
        b[0] += 1;
        b[1] += m.usage.cache_creation_input_tokens ?? 0;
        b[2] += c.context;
      }
      firstPending = false;
      lastCallAt = at;
      for (const it of m.usage.iterations ?? []) {
        if (it.type !== "advisor_message") continue;
        const a = callCost(it.model, it).total;
        advisor.calls += 1;
        advisor.cost += a;
        c.total += a;
      }
      total += c.total;
      byAgent[type] = (byAgent[type] ?? 0) + c.total;
      if (c.context > 150_000) over150k += c.total;
      if (c.rewrite) {
        const reason =
          lastModel === null
            ? "first"
            : compacted
              ? "compaction"
              : m.model !== lastModel
                ? "model"
                : null;
        if (reason) {
          expected[reason] += 1;
          expectedCost += c.write;
        } else rewrites += c.write;
      }
      lastModel = m.model;
      compacted = false;
      if (type === "main" && wake) wakeCost += c.total;
      for (const key of type === "main" ? ["all", "main"] : ["all"]) {
        cache[key][0] += c.context;
        cache[key][1] += c.read;
      }
    }
  }
  const share = (x) => (total ? Math.round((1000 * x) / total) / 10 : 0);
  const hit = ([context, read]) =>
    context ? Math.round((1000 * read) / context) / 10 : null;
  const capped = limited.filter((r) => r.capped);
  return {
    total: Math.round(total * 100) / 100,
    turnCap: {
      runs: limited.length,
      capped: briefStats(capped),
      other: briefStats(limited.filter((r) => !r.capped)),
    },
    byAgent: Object.entries(byAgent)
      .sort((a, b) => b[1] - a[1])
      .map(([type, cost]) => ({
        type,
        cost: Math.round(cost * 100) / 100,
        share: share(cost),
      })),
    over150kShare: share(over150k),
    rewriteShare: share(rewrites),
    expectedRewrites: expected,
    expectedRewriteShare: share(expectedCost),
    mainTurns: turns,
    wakeShare: share(wakeCost),
    advisor: { calls: advisor.calls, share: share(advisor.cost) },
    cacheHitRate: { all: hit(cache.all), main: hit(cache.main) },
    firstCallAfterPrompt: Object.fromEntries(
      Object.entries(first).map(([k, [calls, write, context]]) => [
        k,
        {
          calls,
          avgWrite: calls ? Math.round(write / calls) : 0,
          writeShare: context ? Math.round((1000 * write) / context) / 10 : 0,
        },
      ]),
    ),
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
    const e = r.expectedRewrites;
    console.log(
      `Full cache rewrites that nothing explains: ${r.rewriteShare}% of cost. Expected rewrites: ${r.expectedRewriteShare}% (${e.first} first calls, ${e.compaction} after compaction, ${e.model} after a model switch)`,
    );
    console.log(
      `Main turns started by background agents: ${r.mainTurns.wake} of ${r.mainTurns.wake + r.mainTurns.other}, ${r.wakeShare}% of cost`,
    );
    console.log(
      `Advisor calls: ${r.advisor.calls}, ${r.advisor.share}% of cost (each reads the whole context without the cache)`,
    );
    // The cost guide: below about 80%, something is breaking the cache.
    console.log(
      `Cache hit rate: ${r.cacheHitRate.all ?? "-"}% of input tokens (main conversation ${r.cacheHitRate.main ?? "-"}%). Below about 80%, something breaks the cache.`,
    );
    const f = r.firstCallAfterPrompt;
    console.log(
      `First warm call after a prompt: ${f.with.writeShare}% of context written with hook context in history (${f.with.calls} calls), ${f.without.writeShare}% without (${f.without.calls} calls)`,
    );
    const other = new Map(r.turnCap.other.map((o) => [o.type, o]));
    console.log(
      `Runs that reached the turn-limit reserve: ${r.turnCap.capped.reduce((n, c) => n + c.runs, 0)} of ${r.turnCap.runs} (median files and list items in the brief, capped vs other)`,
    );
    for (const c of r.turnCap.capped) {
      const o = other.get(c.type) ?? { runs: 0, files: 0, items: 0 };
      console.log(
        `  ${c.type.padEnd(32)} ${c.runs} of ${c.runs + o.runs}  files ${c.files} vs ${o.files}  items ${c.items} vs ${o.items}`,
      );
    }
  }
}
