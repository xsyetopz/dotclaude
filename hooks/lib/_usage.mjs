// The user's Claude usage, from the copy of the /api/oauth/usage response that
// Claude Code caches in ~/.claude.json (`cachedUsageUtilization`). Claude Code
// writes it whenever it fetches usage and treats it as stale after an hour;
// dotclaude uses the same limit. No token is read and nothing is fetched.
// Also the main conversation's context size and compactions, from its
// transcript, for the status line.

import { compactionCount } from "./_io-node.mjs";
import { readConfig } from "./_plans.mjs";
import { tail } from "./_transcript.mjs";
import { mainContextFromText } from "./_transcript-parse.mjs";

const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * { session, weekly, fable } as percentages, { sessionResetsAt,
 * weeklyResetsAt } as epoch ms (each null when absent), and fetchedAtMs, or
 * null when there is no fresh copy.
 */
export async function readUsage(io, now = Date.now()) {
  const cached = (await readConfig(io))?.cachedUsageUtilization;
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
  return text ? mainContextFromText(text) : null;
}

/**
 * Compactions recorded in a transcript, or 0 when it cannot be read. The
 * reader and its cache are `compactionCount` in `_io-node.mjs`.
 */
export function compactions(transcriptPath) {
  return compactionCount(transcriptPath) ?? 0;
}
