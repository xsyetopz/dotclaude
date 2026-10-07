#!/usr/bin/env bun
// Where Claude Code usage went, from the session transcripts under
// ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects).
//
//   bun tools/usage-report.mjs [--days 7] [--root DIR] [--runs 20] [--json]
//
// Costs are API-equivalent dollars at list prices: a subscription does not
// bill them, but its limits track the same token mix, so the shares show
// what spends a plan's limits. Reports the share by agent type, the share of
// calls whose context is past CONTEXT_WINDOW, and the cost of full cache
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
// It also counts main sessions by Claude Code entrypoint (`cli`, `claude-vscode`,
// `sdk-cli`, `sdk-py`) and the wake turns of each entrypoint, usage-limit hits (the synthetic assistant message
// with `error: "rate_limit"` that Claude Code writes), `Skill` tool calls by
// skill, and the dotclaude guard verdicts per rule from `verdicts.jsonl`.
// The delegation share compares main-conversation turns with subagent runs,
// and sizes the tool results that enter the main context per session.
// The run table lists the latest subagent runs with the cost of each.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONTEXT_WINDOW } from "../plugins/dotclaude/lib/budget.mjs";
import { maxTurns, reserve, tokens, turnsFromText } from "./usage-lib.mjs";

const k = (n) => `${Math.round(n / 1000)}k`;

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

// The `q` quantile of `xs`, by the nearest rank.
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.ceil(q * s.length) - 1)] : 0;
};

const resultText = (c) =>
  typeof c === "string"
    ? c
    : (Array.isArray(c) ? c : []).map((b) => b.text ?? "").join("\n");

/** The first line of `text`, cut to about 80 characters. */
function firstLine(text) {
  const line =
    String(text ?? "")
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("agentId:")) ?? "";
  const t = line.trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

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

// A deny reason starts with "blocked this <label>." Its next sentence names
// the first rule that fired.
function verdictRule(reason) {
  const text = String(reason).replace(/^blocked this [\w ]+?\. /, "");
  return text.match(/^.*?\.(?=\s|$)/)?.[0] ?? text;
}

function verdictCounts(file, since) {
  let lines;
  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch {
    return [];
  }
  const counts = new Map();
  for (const line of lines) {
    let v;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    if (!(new Date(v.time) >= since)) continue;
    const rule = verdictRule(v.reason ?? "");
    const key = `${v.level}\0${rule}`;
    const c = counts.get(key) ?? { level: v.level, rule, count: 0 };
    c.count += 1;
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

export function report(root, since, verdictsFile = null, runLimit = 20) {
  const byAgent = {};
  const entrypoints = {};
  const skills = {};
  let limitHits = 0;
  let total = 0;
  let overWindow = 0;
  let rewrites = 0;
  let expectedCost = 0;
  const expected = { first: 0, compaction: 0, model: 0 };
  // Main-conversation turns by what started them: a background agent's
  // report or task notification, or anything else (mostly the user).
  const turns = { wake: 0, other: 0 };
  // Wake turns by entrypoint: the fork-mode setting that keeps agents in the
  // foreground may not reach SDK sessions.
  const wakes = {};
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
  // Output tokens, messages, and messages without a final record.
  const output = { tokens: 0, messages: 0, unfinished: 0 };
  // Delegation: main assistant turns, subagent runs, the tokens that tool
  // results add to each main session, and what each `Agent` call said.
  let mainTurns = 0;
  const runsByType = {};
  const sessionResultTokens = [];
  const runs = [];
  const agentCalls = new Map();
  const files = fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(root, f))
    .filter((f) => fs.statSync(f).mtimeMs >= since.getTime());
  for (const file of files) {
    const type = agentType(file);
    const limit = type === "main" ? null : maxTurns(type);
    if (limit)
      limited.push({
        type,
        capped:
          turnsFromText(fs.readFileSync(file, "utf8")) >=
          limit - reserve(limit),
        ...briefSize(file),
      });
    const seen = new Set();
    let fileCost = 0;
    let resultTokens = 0;
    let handback = "";
    let wake = false;
    let hookContext = false;
    let firstPending = false;
    let lastCallAt = null;
    let lastModel = null;
    let compacted = false;
    let entrypoint = null;
    const entries = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n"))
      try {
        entries.push(JSON.parse(line));
      } catch {}
    // Claude Code writes a message's usage once per content block. The first
    // record is the stream start, with an output count near zero, so each
    // message counts the record with the largest output. Subagent transcripts
    // often keep no final record, so that count is a lower bound.
    const best = new Map();
    for (const e of entries) {
      const u = e.type === "assistant" && e.message?.usage;
      if (!u) continue;
      const b = best.get(e.message.id);
      if (!b || (u.output_tokens ?? 0) > (b.usage.output_tokens ?? 0))
        best.set(e.message.id, { usage: u, final: b?.final });
      if (e.message.stop_reason) best.get(e.message.id).final = true;
    }
    for (const entry of entries) {
      if (
        type === "main" &&
        !entrypoint &&
        entry.entrypoint &&
        new Date(entry.timestamp) >= since
      ) {
        entrypoint = entry.entrypoint;
        entrypoints[entrypoint] = (entrypoints[entrypoint] ?? 0) + 1;
      }
      const m = entry.message;
      switch (entry.type) {
        case "assistant":
          if (new Date(entry.timestamp) < since) break;
          if (entry.error === "rate_limit") limitHits += 1;
          // One API message can span several entries, one per content block,
          // so a tool call is counted by its own id and not by the message id.
          for (const b of Array.isArray(m?.content) ? m.content : []) {
            if (b.type !== "tool_use") continue;
            if (b.name === "Skill" && b.input?.skill && !seen.has(b.id)) {
              seen.add(b.id);
              skills[b.input.skill] = (skills[b.input.skill] ?? 0) + 1;
            }
            if (type === "main" && (b.name === "Agent" || b.name === "Task"))
              agentCalls.set(b.id, {
                description: b.input?.description ?? "",
                handback: "",
              });
            if (type !== "main" && b.name === "SubagentHandback")
              handback = firstLine(b.input?.message);
          }
          break;
        case "attachment":
          if (
            entry.attachment?.type === "hook_additional_context" &&
            entry.attachment.hookEvent !== "SessionStart"
          )
            hookContext = true;
          break;
        case "system":
          if (entry.subtype === "compact_boundary") compacted = true;
          break;
        case "user":
          if (type === "main") {
            const content = m?.content;
            if (new Date(entry.timestamp) >= since)
              for (const b of Array.isArray(content) ? content : []) {
                if (b.type !== "tool_result") continue;
                const text = resultText(b.content);
                // Estimate with the shared token estimate, from content length.
                resultTokens += tokens(text);
                const call = agentCalls.get(b.tool_use_id);
                if (call) {
                  call.handback = firstLine(text);
                  call.agentId =
                    entry.toolUseResult?.agentId ??
                    text.match(/agentId: (\w+)/)?.[1];
                }
              }
            const toolResult =
              Array.isArray(content) &&
              content.some((b) => b.type === "tool_result");
            // Meta reminders without an origin continue the current turn.
            if (!toolResult && !(entry.isMeta && !entry.origin)) {
              const kind = entry.origin?.kind;
              wake = kind === "peer" || kind === "task-notification";
              firstPending = true;
              if (new Date(entry.timestamp) >= since) {
                turns[wake ? "wake" : "other"] += 1;
                const ep = entrypoint ?? "unknown";
                if (wake) wakes[ep] = (wakes[ep] ?? 0) + 1;
              }
            }
            continue;
          }
          break;
      }
      if (entry.type !== "assistant" || !m?.usage) continue;
      if (new Date(entry.timestamp) < since || seen.has(m.id)) continue;
      seen.add(m.id);
      const { usage, final } = best.get(m.id);
      output.tokens += usage.output_tokens ?? 0;
      output.messages += 1;
      if (!final) output.unfinished += 1;
      const c = callCost(m.model, usage);
      const at = Date.parse(entry.timestamp);
      if (firstPending && lastCallAt !== null && at - lastCallAt < 300_000) {
        const b = first[hookContext ? "with" : "without"];
        b[0] += 1;
        b[1] += usage.cache_creation_input_tokens ?? 0;
        b[2] += c.context;
      }
      firstPending = false;
      lastCallAt = at;
      for (const it of usage.iterations ?? []) {
        if (it.type !== "advisor_message") continue;
        const a = callCost(it.model, it).total;
        advisor.calls += 1;
        advisor.cost += a;
        c.total += a;
      }
      total += c.total;
      fileCost += c.total;
      if (type === "main") mainTurns += 1;
      byAgent[type] = (byAgent[type] ?? 0) + c.total;
      if (c.context > CONTEXT_WINDOW) overWindow += c.total;
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
    if (type === "main") sessionResultTokens.push(resultTokens);
    else {
      runsByType[type] = (runsByType[type] ?? 0) + 1;
      runs.push({
        id: path.basename(file, ".jsonl").replace(/^agent-/, ""),
        type,
        cost: fileCost,
        handback,
        at: fs.statSync(file).mtimeMs,
      });
    }
  }
  const byId = new Map(
    [...agentCalls.values()]
      .filter((c) => c.agentId)
      .map((c) => [c.agentId, c]),
  );
  const latest = runs
    .sort((a, b) => b.at - a.at)
    .slice(0, runLimit)
    .map((r) => {
      const call = byId.get(r.id);
      return {
        id: r.id,
        type: r.type,
        description: call?.description ?? "",
        cost: Math.round(r.cost * 100) / 100,
        handback: r.handback || call?.handback || "",
      };
    });
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
    entrypoints,
    wakesByEntrypoint: wakes,
    limitHits,
    skills: Object.entries(skills)
      .sort((a, b) => b[1] - a[1])
      .map(([skill, uses]) => ({ skill, uses })),
    verdicts: verdictsFile ? verdictCounts(verdictsFile, since) : [],
    overWindowShare: share(overWindow),
    rewriteShare: share(rewrites),
    expectedRewrites: expected,
    expectedRewriteShare: share(expectedCost),
    mainTurns: turns,
    wakeShare: share(wakeCost),
    advisor: { calls: advisor.calls, share: share(advisor.cost) },
    output,
    delegation: {
      mainTurns,
      runs: runs.length,
      runsByType: Object.entries(runsByType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => ({ type, runs: n })),
      runsPer100Turns: mainTurns
        ? Math.round((1000 * runs.length) / mainTurns) / 10
        : null,
      resultTokensPerSession: {
        sessions: sessionResultTokens.length,
        median: median(sessionResultTokens),
        p90: quantile(sessionResultTokens, 0.9),
      },
      latestRuns: latest,
    },
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
  // The plugin data directory of the marketplace install.
  const verdicts = opt(
    "--verdicts",
    path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
      "plugins",
      "data",
      "dotclaude-dotclaude",
      "verdicts.jsonl",
    ),
  );
  const r = report(
    root,
    new Date(Date.now() - days * 86_400_000),
    verdicts,
    Number(opt("--runs", "20")),
  );
  if (args.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`Last ${days} days: $${r.total} API-equivalent`);
    for (const a of r.byAgent.slice(0, 10))
      console.log(
        `  ${a.type.padEnd(32)} $${a.cost.toFixed(2).padStart(9)}  ${a.share}%`,
      );
    console.log(
      `Calls with context past ${k(CONTEXT_WINDOW)}: ${r.overWindowShare}% of cost`,
    );
    const o = r.output;
    console.log(
      `Output tokens: ${o.tokens} in ${o.messages} messages. ${o.unfinished} messages have no final record, so their count is a lower bound.`,
    );
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
    const eps = Object.entries(r.entrypoints)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
    console.log(`Sessions by entrypoint: ${eps || "-"}`);
    const wakes = Object.entries(r.wakesByEntrypoint)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
    console.log(`Wake turns by entrypoint: ${wakes || "-"}`);
    console.log(`Usage-limit hits: ${r.limitHits}`);
    console.log(
      `Skill calls: ${r.skills.map((s) => `${s.skill} ${s.uses}`).join(", ") || "-"}`,
    );
    console.log(
      `Guard verdicts per rule (${verdicts}): ${r.verdicts.length ? "" : "none"}`,
    );
    for (const v of r.verdicts.slice(0, 10))
      console.log(
        `  ${v.level.padEnd(10)} ${String(v.count).padStart(5)}  ${v.rule.slice(0, 100)}`,
      );
    const d = r.delegation;
    console.log(
      `Delegation: ${d.runs} subagent runs in ${d.mainTurns} main turns, ${d.runsPer100Turns ?? "-"} per 100 turns (${d.runsByType.map((t) => `${t.type} ${t.runs}`).join(", ") || "-"})`,
    );
    console.log(
      `Tool results in the main context per session, estimated tokens: median ${d.resultTokensPerSession.median}, p90 ${d.resultTokensPerSession.p90} (${d.resultTokensPerSession.sessions} sessions)`,
    );
    console.log(`Latest ${d.latestRuns.length} subagent runs:`);
    for (const run of d.latestRuns)
      console.log(
        `  ${run.id.slice(0, 8).padEnd(8)} ${run.type.slice(0, 24).padEnd(24)} $${run.cost.toFixed(2).padStart(6)}  ${run.description.slice(0, 40)} | ${run.handback}`,
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
