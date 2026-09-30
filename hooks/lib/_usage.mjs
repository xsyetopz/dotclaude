// The user's Claude usage, from the copy of the /api/oauth/usage response that
// Claude Code caches in ~/.claude.json (`cachedUsageUtilization`). Claude Code
// writes it whenever it fetches usage and treats it as stale after an hour;
// dotclaude uses the same limit. No token is read and nothing is fetched.
// Also the main conversation's context size, from the end of its transcript.

import fs from "node:fs";
import path from "node:path";
import { CONTEXT_NOTE_TOKENS, k } from "./_budget.mjs";
import { stateDir } from "./_common.mjs";
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

/**
 * The `<context_use>` note when the main context is at CONTEXT_NOTE_TOKENS or
 * more, else null. With `once`, the note comes only the first time after the
 * context was last under the bound, so a long run of tool calls gets it once.
 * Each note marks the session, so a note after a prompt also counts.
 */
export function contextNote(data, once = false) {
  const used = mainContextTokens(data.transcript_path);
  if (used === null) return null;
  const safe = String(data.session_id || "unknown").replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  );
  const file = path.join(stateDir(), `${safe}.context-note`);
  if (used < CONTEXT_NOTE_TOKENS) {
    fs.rmSync(file, { force: true });
    return null;
  }
  if (once && fs.existsSync(file)) return null;
  fs.writeFileSync(file, "");
  return `<context_use source="dotclaude">The main context is ${k(used)} tokens. Every turn re-reads all of it, and automatic compaction keeps only a summary that you do not choose. Finish the current step. Then write a handoff note with the \`write-session-handoff\` skill, and ask the user to run \`/clear\`.</context_use>`;
}
