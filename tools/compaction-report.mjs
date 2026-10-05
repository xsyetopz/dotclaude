#!/usr/bin/env bun
// What each automatic compaction of the main conversation costs and loses,
// from the session transcripts under ~/.claude/projects (or
// $CLAUDE_CONFIG_DIR/projects). It uses no Claude usage.
//
//   bun tools/compaction-report.mjs [--days 14] [--max-pre N] [--root DIR]
//     [--json]
//
// `--max-pre N` keeps only the sessions whose compactions all started at N
// tokens or less, so that one `autoCompactWindow` value sets every part.
//
// Each compacted main session splits into parts at its `compact_boundary`
// entries. Part 0 comes before the first compaction. For each part, the
// report gives the calls, the API-equivalent cost, the cost per call, the
// median context, and the context just after the compaction.
//
// Retention: a needed token is a path, number, or identifier of 8 or more
// characters that a tool result of an earlier part introduced and that Claude
// uses in a tool input within
// the first 40 tool calls of a part. It was kept when the compaction summary,
// the messages that the compaction kept, or other context put it in view
// before the use. It was read again when a tool result of the part gave it
// first. Else it came from neither. Old tokens come from part 0, so their
// kept share after compaction N shows how the earliest facts degrade.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { callCost } from "./usage-report.mjs";

const WINDOW = 40;
const TOKEN = /[A-Za-z0-9_./:@-]{8,}/g;
const SPECIFIC = /[/._:@]|\d|[a-z][A-Z]/;

function tokens(text) {
  const out = new Set();
  for (const t of String(text).match(TOKEN) ?? []) {
    const clean = t.replace(/^[.:/-]+|[.:/-]+$/g, "");
    if (clean.length >= 8 && SPECIFIC.test(clean)) out.add(clean);
  }
  return out;
}

const textOf = (value) =>
  typeof value === "string" ? value : JSON.stringify(value ?? "");

/** The text of an entry as `{ context, result, use }` token sets. */
function entryTokens(entry) {
  const out = { context: new Set(), result: new Set(), use: [] };
  const add = (set, text) => {
    for (const t of tokens(text)) set.add(t);
  };
  const content = entry.message?.content;
  switch (entry.type) {
    case "user":
      if (typeof content === "string") add(out.context, content);
      else
        for (const b of content ?? [])
          add(b.type === "tool_result" ? out.result : out.context, textOf(b));
      break;
    case "assistant":
      for (const b of Array.isArray(content) ? content : [])
        if (b.type === "tool_use") out.use.push(tokens(textOf(b.input)));
      break;
    case "attachment":
      add(out.context, textOf(entry.attachment));
      break;
  }
  return out;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** One main transcript as parts, or null when it has no compaction. */
export function sessionParts(file) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes('"subtype":"compact_boundary"')) return null;
  const byUuid = new Map();
  const origin = new Map();
  const usage = new Map();
  const parts = [];
  let part = null;
  const open = (post = null) => {
    part = {
      post,
      calls: [],
      seenContext: new Set(),
      seenResult: new Set(),
      toolCalls: 0,
      needed: new Map(),
    };
    parts.push(part);
  };
  open();
  for (const line of text.split("\n")) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      const meta = entry.compactMetadata ?? {};
      open(meta.postTokens ?? null);
      part.pre = meta.preTokens ?? null;
      for (const id of meta.preservedMessages?.uuids ?? [])
        for (const t of byUuid.get(id) ?? []) part.seenContext.add(t);
      continue;
    }
    const m = entry.message;
    if (entry.type === "assistant" && m?.id && m.usage)
      usage.set(m.id, { part, model: m.model, usage: m.usage });
    const found = entryTokens(entry);
    const index = parts.length - 1;
    // Only a tool result introduces a needed token. A token that context
    // gave first, such as a `CLAUDE.md` path, comes back after each
    // compaction without the summary.
    for (const t of found.context) if (!origin.has(t)) origin.set(t, null);
    for (const t of found.result) if (!origin.has(t)) origin.set(t, index);
    for (const t of found.context) part.seenContext.add(t);
    for (const t of found.result) part.seenResult.add(t);
    for (const use of found.use) {
      part.toolCalls += 1;
      for (const t of use) {
        const from = origin.get(t);
        if (
          index > 0 &&
          part.toolCalls <= WINDOW &&
          from !== null &&
          from < index
        )
          if (!part.needed.has(t))
            part.needed.set(t, {
              from,
              how: part.seenContext.has(t)
                ? "kept"
                : part.seenResult.has(t)
                  ? "read"
                  : "neither",
            });
        if (!origin.has(t)) origin.set(t, null);
      }
    }
    if (entry.uuid)
      byUuid.set(entry.uuid, new Set([...found.context, ...found.result]));
  }
  for (const { part: p, model, usage: u } of usage.values())
    p.calls.push(callCost(model, u));
  return parts;
}

export function report(root, since, maxPre = Infinity) {
  const files = fs
    .readdirSync(root, { recursive: true })
    .map(String)
    .filter(
      (f) =>
        f.endsWith(".jsonl") && !f.includes(`${path.sep}subagents${path.sep}`),
    )
    .map((f) => path.join(root, f))
    .filter((f) => fs.statSync(f).mtimeMs >= since.getTime());
  const rows = [];
  let sessions = 0;
  for (const file of files) {
    const parts = sessionParts(file);
    if (!parts || parts.some((p) => p.pre > maxPre)) continue;
    sessions += 1;
    parts.forEach((p, i) => {
      const n = Math.min(i, 5);
      rows[n] ??= {
        part: n === 5 ? "5+" : String(n),
        parts: 0,
        calls: 0,
        cost: 0,
        context: [],
        post: [],
        pre: [],
        needed: { kept: 0, read: 0, neither: 0 },
        old: { kept: 0, read: 0, neither: 0 },
      };
      const r = rows[n];
      r.parts += 1;
      r.calls += p.calls.length;
      for (const c of p.calls) {
        r.cost += c.total;
        r.context.push(c.context);
      }
      if (p.post) r.post.push(p.post);
      if (p.pre) r.pre.push(p.pre);
      for (const { from, how } of p.needed.values()) {
        r.needed[how] += 1;
        if (from === 0 && i >= 2) r.old[how] += 1;
      }
    });
  }
  const share = (b) => {
    const all = b.kept + b.read + b.neither;
    return all ? { n: all, keptPct: Math.round((100 * b.kept) / all) } : null;
  };
  return {
    sessions,
    parts: rows.filter(Boolean).map((r) => ({
      part: r.part,
      parts: r.parts,
      calls: r.calls,
      cost: Math.round(r.cost),
      costPerCall: r.calls ? +(r.cost / r.calls).toFixed(3) : 0,
      medianContext: median(r.context),
      medianPreTokens: median(r.pre),
      medianPostTokens: median(r.post),
      needed: r.needed,
      kept: share(r.needed),
      oldKept: share(r.old),
    })),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const days = Number(arg("--days", 14));
  const root = arg(
    "--root",
    path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
      "projects",
    ),
  );
  const r = report(
    root,
    new Date(Date.now() - days * 86_400_000),
    Number(arg("--max-pre", Infinity)),
  );
  if (args.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`Compacted main sessions in ${days} days: ${r.sessions}`);
    console.log(
      "part  parts  calls   cost  $/call  median ctx  pre   post  kept of needed  old kept",
    );
    const k = (n) => `${Math.round(n / 1000)}k`;
    for (const p of r.parts)
      console.log(
        [
          p.part.padEnd(4),
          String(p.parts).padStart(5),
          String(p.calls).padStart(6),
          `$${p.cost}`.padStart(6),
          p.costPerCall.toFixed(3).padStart(7),
          k(p.medianContext).padStart(11),
          k(p.medianPreTokens).padStart(5),
          k(p.medianPostTokens).padStart(6),
          (p.kept ? `${p.kept.keptPct}% of ${p.kept.n}` : "-").padStart(15),
          (p.oldKept
            ? `${p.oldKept.keptPct}% of ${p.oldKept.n}`
            : "-"
          ).padStart(10),
        ].join(" "),
      );
  }
}
