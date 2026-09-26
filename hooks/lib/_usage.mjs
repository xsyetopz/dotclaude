// The user's Claude usage, from the copy of the /api/oauth/usage response that
// Claude Code caches in ~/.claude.json (`cachedUsageUtilization`). Claude Code
// writes it whenever it fetches usage and treats it as stale after an hour;
// dotclaude uses the same limit. No token is read and nothing is fetched.

import { readConfig } from "./_plans.mjs";

const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * { session, weekly, fable, fetchedAtMs } as percentages (null when absent),
 * or null when there is no fresh copy.
 */
export function readUsage(env = process.env, now = Date.now()) {
  const cached = readConfig(env)?.cachedUsageUtilization;
  const at = Number(cached?.fetchedAtMs);
  if (!Number.isFinite(at) || now - at < 0 || now - at > MAX_AGE_MS)
    return null;
  const u = cached.utilization ?? {};
  const pct = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const out = {
    session: pct(u.five_hour?.utilization),
    weekly: pct(u.seven_day?.utilization),
    fable: null,
    fetchedAtMs: at,
  };
  for (const limit of Array.isArray(u.limits) ? u.limits : []) {
    if (limit?.kind === "session") out.session = pct(limit.percent);
    else if (limit?.kind === "weekly_all") out.weekly = pct(limit.percent);
    else if (
      limit?.kind === "weekly_scoped" &&
      /fable/i.test(limit?.scope?.model?.display_name ?? "")
    )
      out.fable = pct(limit.percent);
  }
  return out.session === null && out.weekly === null ? null : out;
}
