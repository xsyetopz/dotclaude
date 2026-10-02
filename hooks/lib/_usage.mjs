// The user's Claude usage, from the copy of the /api/oauth/usage response that
// Claude Code caches in ~/.claude.json (`cachedUsageUtilization`). Claude Code
// writes it whenever it fetches usage and treats it as stale after an hour;
// dotclaude uses the same limit. No token is read and nothing is fetched.
// The hooks module runs this file, so it reads files only through `io`.

import { readConfig } from "./_plans.mjs";

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
