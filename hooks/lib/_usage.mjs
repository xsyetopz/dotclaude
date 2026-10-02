// The user's Claude usage, from the copy of the /api/oauth/usage response that
// Claude Code caches in ~/.claude.json (`cachedUsageUtilization`). Claude Code
// writes it whenever it fetches usage and treats it as stale after an hour;
// dotclaude uses the same limit. No token is read and nothing is fetched.
// Also the main conversation's context size, from the end of its transcript.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AUTO_COMPACT_TOKENS,
  COMPACTIONS_BEFORE_HANDOFF,
  CONTEXT_NOTE_TOKENS,
  k,
} from "./_budget.mjs";
import { stateDir } from "./_core.mjs";
import { nodeIo } from "./_io-node.mjs";
import { readConfig } from "./_plans.mjs";
import { tail } from "./_transcript.mjs";

const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * { session, weekly, fable } as percentages, { sessionResetsAt,
 * weeklyResetsAt } as epoch ms (each null when absent), and fetchedAtMs, or
 * null when there is no fresh copy.
 */
export function readUsage(env = process.env, now = Date.now()) {
  const cached = readConfig(env)?.cachedUsageUtilization;
  const at = Number(cached?.fetchedAtMs);
  if (!Number.isFinite(at) || now - at < 0 || now - at > MAX_AGE_MS)
    return null;
  const u = cached.utilization ?? {};
  const pct = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const time = (v) => {
    const ms = Date.parse(v ?? "");
    return Number.isFinite(ms) ? ms : null;
  };
  const out = {
    session: pct(u.five_hour?.utilization),
    weekly: pct(u.seven_day?.utilization),
    fable: null,
    sessionResetsAt: time(u.five_hour?.resets_at),
    weeklyResetsAt: time(u.seven_day?.resets_at),
    fetchedAtMs: at,
  };
  for (const limit of Array.isArray(u.limits) ? u.limits : []) {
    if (limit?.kind === "session") {
      out.session = pct(limit.percent);
      out.sessionResetsAt = time(limit.resets_at) ?? out.sessionResetsAt;
    } else if (limit?.kind === "weekly_all") {
      out.weekly = pct(limit.percent);
      out.weeklyResetsAt = time(limit.resets_at) ?? out.weeklyResetsAt;
    } else if (
      limit?.kind === "weekly_scoped" &&
      /fable/i.test(limit?.scope?.model?.display_name ?? "")
    )
      out.fable = pct(limit.percent);
  }
  return out.session === null && out.weekly === null ? null : out;
}

/**
 * The main conversation's context in tokens: the input of its last response,
 * or the size after a later compaction. Null when the last 1 MB of the
 * transcript has neither.
 */
export function mainContextTokens(transcriptPath) {
  const text = transcriptPath ? tail(transcriptPath, 1_000_000) : null;
  if (!text) return null;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.includes('"usage"') && !line.includes('"compact_boundary"'))
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isSidechain) continue;
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      const after = Number(entry.compactMetadata?.postTokens);
      return Number.isFinite(after) ? after : null;
    }
    const u = entry.type === "assistant" ? entry.message?.usage : null;
    if (u)
      return (
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0)
      );
  }
  return null;
}

const BOUNDARY = Buffer.from('"subtype":"compact_boundary"');

/**
 * Compactions recorded in a transcript. A quote inside a message is escaped
 * in JSON, so only a real `compact_boundary` entry matches.
 *
 * The status line calls this on each refresh, and a long transcript is tens
 * of MB. A cache file keeps the count and the byte offset after the last
 * complete line, so each call reads only the lines appended since. A
 * different inode, a shorter file, or no newline before the offset means
 * that the transcript was replaced, and the count starts again from 0.
 */
export function compactions(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, "r");
  } catch {
    return 0;
  }
  try {
    const stat = fs.fstatSync(fd);
    const cacheFile = path.join(
      stateDir(nodeIo()),
      `compactions-${createHash("sha256").update(String(transcriptPath)).digest("hex").slice(0, 16)}.json`,
    );
    let { ino, offset, count } = { ino: stat.ino, offset: 0, count: 0 };
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      const before = Buffer.alloc(1);
      if (
        cached.ino === stat.ino &&
        cached.offset > 0 &&
        cached.offset <= stat.size &&
        fs.readSync(fd, before, 0, 1, cached.offset - 1) === 1 &&
        before[0] === 0x0a
      )
        ({ offset, count } = cached);
    } catch {
      // No cache yet, or another call is replacing it: count from 0.
    }
    if (stat.size === offset) return count;
    const bytes = Buffer.alloc(stat.size - offset);
    const read = fs.readSync(fd, bytes, 0, bytes.length, offset);
    // Stop after the last complete line, so that a line that Claude Code is
    // still writing is read whole next time.
    const end = bytes.subarray(0, read).lastIndexOf(0x0a) + 1;
    for (let i = bytes.indexOf(BOUNDARY); i !== -1 && i < end; ) {
      count += 1;
      i = bytes.indexOf(BOUNDARY, i + BOUNDARY.length);
    }
    if (end > 0) {
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(
          tmp,
          JSON.stringify({ ino, offset: offset + end, count }),
        );
        fs.renameSync(tmp, cacheFile);
      } catch {
        // The count is right. Only the next call reads more.
        fs.rmSync(tmp, { force: true });
      }
    }
    return count;
  } catch {
    return 0;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The `<context_use>` note when the main context is at CONTEXT_NOTE_TOKENS or
 * more after COMPACTIONS_BEFORE_HANDOFF compactions, else null. Before that,
 * automatic compaction runs. With `once`, the note comes only the first time
 * after the context was last under the bound, so a long run of tool calls
 * gets it once. Without `once`, a later note in the same crossing gives only
 * the size and refers to the first one, so Claude does not write the handoff
 * again for each prompt.
 * Each note marks the session, so a note after a prompt also counts.
 */
export function contextNote(data, once = false) {
  const used = mainContextTokens(data.transcript_path);
  if (used === null) return null;
  const safe = String(data.session_id || "unknown").replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  );
  const file = path.join(stateDir(nodeIo()), `${safe}.context-note`);
  if (used < CONTEXT_NOTE_TOKENS) {
    fs.rmSync(file, { force: true });
    return null;
  }
  const told = fs.existsSync(file);
  if (once && told) return null;
  const count = compactions(data.transcript_path);
  if (count < COMPACTIONS_BEFORE_HANDOFF) return null;
  if (told)
    return `<context_use source="dotclaude">The main context is ${k(used)} tokens after ${count} compactions. An earlier note in this context asked for a handoff note. If you did not write it, write it now. If you wrote it, update it only when a decision or the state changed, or when this request cannot finish before Claude Code compacts at about ${k(AUTO_COMPACT_TOKENS)} tokens. Continue the work, and at the next natural stop ask the user to run \`/clear\`.</context_use>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  return `<context_use source="dotclaude">The main context is ${k(used)} tokens after ${count} compactions. Each compaction summarizes the previous summary again, so the earliest facts degrade. Claude Code compacts again at about ${k(AUTO_COMPACT_TOKENS)} tokens, and a step can take longer than that. Thus write a handoff note now with the \`handoff\` skill, before you finish the current step. If you wrote one after the last compaction, update it only when the state changed. This note does not stop the work. After the handoff, continue the current step and the user's requests, and add each new request to the handoff note. At the next natural stop, ask the user to run \`/clear\`.</context_use>`;
}
