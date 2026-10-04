// One function for each part of a status line. Each returns colored text,
// or "" when its data is absent.

import {
  AUTO_COMPACT_TOKENS,
  k,
  SUBAGENT_EFFORTS,
  USAGE_LEVELS,
} from "../hooks/lib/_budget.mjs";
import { clock, countdown, money } from "./format.mjs";
import { alarm, C, ICON, levelColor, meter } from "./paint.mjs";

/** " 82%" in four columns. */
const percent = (pct) => `${pct}%`.padStart(4);

/** Context against `limit`, with a blinking `⚠` from the second level. */
export function contextPart(tokens, limit, now) {
  const pct = (tokens / limit) * 100;
  return (
    alarm(pct >= USAGE_LEVELS[1], now) +
    meter(ICON.context, pct, `${k(tokens)}/${k(limit)}`)
  );
}

/** The effort levels that the rules allow for a model, or undefined. */
function allowedEfforts(modelId) {
  const m = /claude-([a-z]+)-(\d+)-(\d{1,2})(?!\d)/i.exec(
    String(modelId ?? ""),
  );
  return m && SUBAGENT_EFFORTS[`${m[1]}-${m[2]}-${m[3]}`.toLowerCase()];
}

/** " high", red with a `⚠` when the rules do not allow it for the model. */
export function effortPart(modelId, level) {
  if (!level) return "";
  const allowed = allowedEfforts(modelId);
  return allowed && !allowed.includes(level)
    ? ` ${C.red(`${level} ${ICON.warn}`)}`
    : ` ${C.dim(level)}`;
}

/** The cache expiry: minutes left (blinking in the last two), else cold. */
export function cacheExpiry(cache, now) {
  const left = cache.warm ? cache.expires_at - now / 1000 : 0;
  if (!(left > 0)) {
    const recache = cache.recache_tokens_if_cold ?? 0;
    const tokens = recache
      ? ` ${levelColor((recache / AUTO_COMPACT_TOKENS) * 100)(k(recache))}`
      : "";
    return C.dim(`${ICON.cold} cold`) + tokens;
  }
  return `${alarm(left <= 120, now)}${C.green(`${ICON.warm} ${countdown(left)}`)}`;
}

/**
 * Hit ratio and misses of the prompt cache. A hit ratio is good when high,
 * so the scale reads its miss share, `100 - hit`. Misses that tell nothing
 * do not count: idle time past the TTL (the countdown shows it), and a model
 * switch (it starts a new cache). Claude Code records a TTL cause only when
 * no other cause applies, and each miss adds 1 to each cause, so subtracting
 * these counts is exact.
 */
export function cacheDetail(cache) {
  const causes = cache.miss_causes ?? {};
  const misses =
    (cache.misses ?? 0) -
    (causes.ttl_expired_5m ?? 0) -
    (causes.ttl_expired_1h ?? 0) -
    (causes.model_changed ?? 0);
  const hit =
    typeof cache.hit_ratio === "number"
      ? Math.round(cache.hit_ratio * 100)
      : null;
  const last = (cache.last_miss_cause?.causes ?? []).find(
    (c) => c !== "model_changed" && !c.startsWith("ttl_expired"),
  );
  return [
    hit !== null && `${C.dim("hit")} ${levelColor(100 - hit)(`${hit}%`)}`,
    misses > 0 &&
      C.yellow(
        `${ICON.miss}${misses}${last ? ` ${last.replace(/_changed$/, "")}` : ""}`,
      ),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * One usage window of `span` seconds: `5h █░░░░  23% ▼10% ↻3pm`, with its
 * pace, and with `⚠` from the second level. The pace is in the part, so that
 * it never shows apart from its window.
 */
export function limitPart(label, window, now, span) {
  const pct = Math.round(window.used_percentage);
  const pace = span ? pacePart(window, now, span) : null;
  const reset =
    window.resets_at * 1000 > now
      ? C.dim(` ${ICON.reset}${clock(window.resets_at, now)}`)
      : "";
  return (
    alarm(pct >= USAGE_LEVELS[1], now) +
    meter(C.dim(label), pct, percent(pct)) +
    (pace ? ` ${pace}` : "") +
    reset
  );
}

/**
 * The pace of a window of `span` seconds: `▲12%→12:46pm` is a deficit (usage
 * runs 12 points ahead of an even rate, and at that rate the limit runs out
 * at 12:46pm), and `▼30%` is a reserve. It shows after 3% of the window.
 */
function pacePart(window, now, span) {
  const left = window.resets_at - now / 1000;
  const gone = (span - left) / span;
  if (!(left >= 0 && left <= span && gone >= 0.03)) return null;
  const used = window.used_percentage;
  const delta = Math.round(used - 100 * gone);
  if (delta < 0) return C.green(`${ICON.reserve}${-delta}%`);
  if (delta === 0) return null;
  const out = now / 1000 + ((100 - used) * gone * span) / used;
  return C.yellow(
    `${ICON.deficit}${delta}%${used < 100 ? `→${clock(out, now)}` : ""}`,
  );
}

/** The limit resets left, `⟳2 by Oct 9 at 3pm`. */
export const resetsPart = ({ left, until }, now) =>
  C.green(`${ICON.credit}${left}`) +
  (until ? C.dim(` by ${clock(until, now)}`) : "");

/** Extra usage spend: `extra █░░░░ $12/$50`, or `extra $12` with no limit. */
export function extraPart({ used, limit, pct, currency }) {
  if (!limit) return `${C.dim("extra")} ${money(used, currency)}`;
  return meter(
    C.dim("extra"),
    pct,
    `${money(used, currency)}/${money(limit, currency)}`,
  );
}

/** The folder, as `project/subdir` when the session moved below its project. */
export function folderPart(workspace, dir) {
  // Windows sends either separator, so compare with `/` only.
  const slash = (p) => p.replaceAll("\\", "/").replace(/\/+$/, "");
  const cwd = slash(dir);
  const project = workspace?.project_dir && slash(workspace.project_dir);
  let name = cwd.split("/").pop() || dir;
  if (project && cwd.startsWith(`${project}/`))
    name = `${project.split("/").pop()}/${cwd.slice(project.length + 1)}`;
  const added = workspace?.added_dirs?.length;
  return C.bold(C.blue(name)) + (added ? C.dim(` +${added}`) : "");
}

/** Branch, changed files, and commits ahead and behind: `⎇ main ±2 ↑1`. */
export const gitPart = (git) =>
  C.magenta(`${ICON.branch} ${git.branch}`) +
  (git.dirty ? C.yellow(` ${ICON.dirty}${git.dirty}`) : "") +
  (git.ahead ? C.cyan(` ${ICON.ahead}${git.ahead}`) : "") +
  (git.behind ? C.cyan(` ${ICON.behind}${git.behind}`) : "");

const REVIEW = { approved: C.green, changes_requested: C.red, draft: C.dim };

/** `#12` (or `!12` for a merge request), linked and colored by review state. */
export function prPart(pr) {
  const label = `${pr.kind === "mr" ? "!" : "#"}${pr.number}`;
  const link = pr.url ? `\x1b]8;;${pr.url}\x07${label}\x1b]8;;\x07` : label;
  return (REVIEW[pr.review_state] ?? C.yellow)(link);
}
