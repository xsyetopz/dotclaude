// Both status lines render here. Every part has one shape, `icon bar number`,
// one bar renderer, one icon set (`ICON`), and one color scale for percent:
// green, yellow at the first `USAGE_LEVELS` value, red at the second. A
// warning glyph blinks from the clock that the caller passes, so the 1 second
// refresh animates it. No emoji, because an emoji takes two columns in some
// terminals and one in others, and the row packing counts columns.
// It imports only the bounds in `hooks/lib/_budget.mjs`.

import {
  AUTO_COMPACT_TOKENS,
  k,
  REVIEWER_CONTEXT_TOKENS,
  SUBAGENT_CONTEXT_TOKENS,
  SUBAGENT_EFFORTS,
  USAGE_LEVELS,
} from "../hooks/lib/_budget.mjs";

export const ICON = {
  warn: "⚠",
  context: "◧",
  compact: "⇊",
  warm: "◷",
  cold: "◌",
  miss: "✘",
  deficit: "▲",
  reserve: "▼",
  reset: "↻",
  credit: "⟳",
  branch: "⎇",
  worktree: "⊞",
  dirty: "±",
  ahead: "↑",
  behind: "↓",
};

const paint = (code) => (text) => text && `\x1b[${code}m${text}\x1b[0m`;
export const C = {
  dim: paint("2"),
  bold: paint("1"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  magenta: paint("35"),
  cyan: paint("36"),
};
const SEP = C.dim(" · ");

/** Visible width: colors and links take no columns. */
export const width = (text) => [...Bun.stripANSI(text)].length;

/** "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5". */
export function shortModel(id) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(
    String(id ?? ""),
  );
  if (!m) return String(id ?? "");
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[3] ? `${m[2]}.${m[3]}` : m[2]}`;
}

/** The one color scale for a percent that grows toward a limit. */
export function levelColor(pct) {
  if (pct >= USAGE_LEVELS[1]) return C.red;
  return pct >= USAGE_LEVELS[0] ? C.yellow : C.green;
}

/** True in the "on" half of each second. The caller passes the clock. */
export const blinkOn = (now) => Math.floor(now / 1000) % 2 === 0;

/** A red `⚠` that blinks while `urgent`. A space keeps the width when off. */
export const alarm = (urgent, now) =>
  urgent ? `${blinkOn(now) ? C.red(ICON.warn) : " "} ` : "";

/** The one bar: five cells, filled by `pct`, colored by the scale. */
export function bar(pct, cells = 5) {
  const full = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * cells);
  return `${levelColor(pct)("█".repeat(full))}${C.dim("░".repeat(cells - full))}`;
}

/** The one part shape: `label bar number`, colored by the scale. */
export const meter = (label, pct, text) =>
  `${label} ${bar(pct)} ${levelColor(pct)(text)}`;

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

/** Time left, rounded up: "4m", "1h5m", "3d". */
const countdown = (sec) => {
  const min = Math.ceil(sec / 60);
  if (min >= 1440) return `${Math.floor(min / 1440)}d`;
  return min >= 60 ? `${Math.floor(min / 60)}h${min % 60}m` : `${min}m`;
};

/** Elapsed minutes: "4m", "1h5m". */
const minutes = (ms) => countdown(Math.floor(ms / 60_000) * 60);

/**
 * A time in Claude Code's own `/usage` format: "3pm" or "3:30pm" within a
 * day, else "Oct 5 at 3pm", with the year when it differs from now.
 */
export function clock(sec, now) {
  const d = new Date(sec * 1000);
  const opts = {
    hour: "numeric",
    minute: d.getMinutes() === 0 ? undefined : "2-digit",
    hour12: true,
  };
  const time = d
    .toLocaleTimeString("en-US", opts)
    .replace(/[  ]([AP]M)/i, (_, m) => m.toLowerCase());
  if (sec * 1000 - now <= 24 * 3600_000) return time;
  // The date and the time are formatted apart, because ICU versions join
  // them with " at " or with ", ".
  const date = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date(now).getFullYear()) date.year = "numeric";
  return `${d.toLocaleDateString("en-US", date)} at ${time}`;
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
function cacheExpiry(cache, now) {
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
function cacheDetail(cache) {
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
    hit !== null && levelColor(100 - hit)(`${hit}%`),
    misses > 0 &&
      C.yellow(
        `${ICON.miss}${misses}${last ? ` ${last.replace(/_changed$/, "")}` : ""}`,
      ),
  ]
    .filter(Boolean)
    .join(" ");
}

/** One usage window: `5h █░░░░  23% ↻3pm`, with `⚠` from the second level. */
function limitPart(label, window, now) {
  const pct = Math.round(window.used_percentage);
  const reset =
    window.resets_at * 1000 > now
      ? C.dim(` ${ICON.reset}${clock(window.resets_at, now)}`)
      : "";
  return (
    alarm(pct >= USAGE_LEVELS[1], now) +
    meter(C.dim(label), pct, percent(pct)) +
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

/** "$12" or "$12.50", or "12.50 XYZ" for a code that `Intl` does not know. */
function money(amount, currency) {
  const digits = Number.isInteger(amount) ? 0 : 2;
  try {
    return amount.toLocaleString("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

/** Extra usage spend: `extra █░░░░ $12/$50`, or `extra $12` with no limit. */
function extraPart({ used, limit, pct, currency }) {
  if (!limit) return `${C.dim("extra")} ${money(used, currency)}`;
  return meter(
    C.dim("extra"),
    pct,
    `${money(used, currency)}/${money(limit, currency)}`,
  );
}

const REVIEW = { approved: C.green, changes_requested: C.red, draft: C.dim };

/** The folder, as `project/subdir` when the session moved below its project. */
function folderPart(workspace, dir) {
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

/** At most this many rows. Past it, the lowest-priority parts go first. */
const MAX_ROWS = 3;

/**
 * Pack each group's parts into rows no wider than `columns`. A group starts
 * a new row, and a part that does not fit goes to the next row.
 */
function pack(groups, columns) {
  const rows = [];
  for (const group of groups) {
    let row = "";
    for (const { text } of group) {
      if (row && width(row + SEP + text) <= columns) row += SEP + text;
      else {
        if (row) rows.push(row);
        row = text;
      }
    }
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * The main status line, in three groups. `core` is what a simple session
 * needs: model, context, cache, limits, limit resets, and extra usage. `place` is where it works.
 * `detail` is for power users: cache hit ratio and misses, limit pace, and
 * cost. Parts carry a priority, and past `MAX_ROWS` rows the lowest go first.
 * `o` has the clock `now`, `columns`, and what `sources.mjs` read: `git`,
 * `loop`, `compactions`, and `usage` (windows for a status JSON without
 * them, `resets`, and `extra`).
 */
export function renderMain(data, o = {}) {
  const { now = Date.now(), columns = 120 } = o;
  const [core, place, detail] = [[], [], []];
  const add = (group, priority, text) => {
    if (text) group.push({ priority, text });
  };

  const model = shortModel(data.model?.id) || data.model?.display_name;
  if (model)
    add(
      core,
      8,
      C.bold(model) +
        effortPart(data.model?.id, data.effort?.level) +
        (data.fast_mode ? ` ${C.red("FAST")}` : ""),
    );
  const tokens = data.context_window?.total_input_tokens;
  if (tokens > 0)
    add(
      core,
      10,
      contextPart(tokens, AUTO_COMPACT_TOKENS, now) +
        (o.compactions > 0 ? C.dim(` ${ICON.compact}${o.compactions}`) : ""),
    );
  const cache = data.prompt_cache;
  if (cache?.caching_observed) {
    add(core, 7, cacheExpiry(cache, now));
    add(
      detail,
      5,
      cacheDetail(cache) && `${C.dim(ICON.warm)} ${cacheDetail(cache)}`,
    );
  }

  const { resets, extra, ...copied } = o.usage ?? {};
  const limits = { ...copied, ...data.rate_limits };
  for (const [key, label, priority, span] of [
    ["five_hour", "5h", 5, 5 * 3600],
    ["seven_day", "7d", 4, 7 * 86_400],
    ["spend_limit", "spend", 4, 0],
  ]) {
    const window = limits[key];
    if (!Number.isFinite(window?.used_percentage)) continue;
    // A limit past the first level outranks all but the context. Its pace
    // has the same rank, so that it does not drop before a calm window's.
    const rank = window.used_percentage >= USAGE_LEVELS[0] ? 9 : priority;
    add(core, rank, limitPart(label, window, now));
    const pace = span && pacePart(window, now, span);
    add(detail, rank, pace && `${C.dim(label)} ${pace}`);
  }
  if (resets) {
    // A reset refills a window at its limit, so there it outranks the window.
    const atLimit = Object.values(limits).some(
      (w) => w?.used_percentage >= USAGE_LEVELS[1],
    );
    add(
      core,
      atLimit ? 9 : 4,
      C.green(`${ICON.credit}${resets.left}`) +
        (resets.until ? C.dim(` by ${clock(resets.until, now)}`) : ""),
    );
  }
  add(core, 4, extra && extraPart(extra));
  // Subscribers see limits. Others pay per token, so they see the estimate.
  if (!Object.values(limits).some(Boolean) && data.cost?.total_cost_usd >= 0)
    add(detail, 3, C.dim(`$${data.cost.total_cost_usd.toFixed(2)}`));
  const { total_lines_added: added = 0, total_lines_removed: removed = 0 } =
    data.cost ?? {};
  if (added || removed)
    add(detail, 2, `${C.green(`+${added}`)} ${C.red(`-${removed}`)}`);
  if (data.cost?.total_duration_ms > 0)
    add(detail, 1, C.dim(minutes(data.cost.total_duration_ms)));

  const dir = data.workspace?.current_dir || data.cwd || "";
  add(place, 9, dir && folderPart(data.workspace, dir));
  const git = o.git;
  if (git?.branch)
    add(
      place,
      6,
      C.magenta(`${ICON.branch} ${git.branch}`) +
        (git.dirty ? C.yellow(` ${ICON.dirty}${git.dirty}`) : "") +
        (git.ahead ? C.cyan(` ${ICON.ahead}${git.ahead}`) : "") +
        (git.behind ? C.cyan(` ${ICON.behind}${git.behind}`) : ""),
    );
  const worktree = data.worktree?.name || data.workspace?.git_worktree;
  add(place, 5, worktree && C.cyan(`${ICON.worktree} ${worktree}`));
  if (data.pr?.number) {
    const label = `${data.pr.kind === "mr" ? "!" : "#"}${data.pr.number}`;
    const link = data.pr.url
      ? `\x1b]8;;${data.pr.url}\x07${label}\x1b]8;;\x07`
      : label;
    add(place, 3, (REVIEW[data.pr.review_state] ?? C.yellow)(link));
  }
  add(place, 4, o.loop && C.cyan(`loop ${o.loop.done}/${o.loop.total}`));
  add(place, 4, data.agent?.name && C.magenta(`@${data.agent.name}`));
  add(place, 3, data.vim?.mode && C.bold(data.vim.mode));
  const name = data.session_name;
  if (name)
    add(place, 1, C.dim(name.length > 32 ? `${name.slice(0, 31)}…` : name));

  const groups = [core, place, detail];
  let rows = pack(groups, columns);
  while (rows.length > MAX_ROWS && groups.flat().length > 1) {
    const lowest = groups
      .flat()
      .reduce((a, b) => (b.priority < a.priority ? b : a));
    for (const group of groups)
      if (group.includes(lowest)) group.splice(group.indexOf(lowest), 1);
    rows = pack(groups, columns);
  }
  return rows.join("\n");
}

/**
 * One subagent row body: name, model and effort, context against the budget,
 * and run time. The description fills what is left.
 */
export function renderTask(
  task,
  agentType,
  { now = Date.now(), columns = 100 } = {},
) {
  const limit =
    agentType === "reviewer"
      ? REVIEWER_CONTEXT_TOKENS
      : SUBAGENT_CONTEXT_TOKENS;
  const model = task.model && shortModel(task.model);
  const start =
    typeof task.startTime === "number"
      ? task.startTime
      : Date.parse(task.startTime);
  const line = [
    C.bold(task.name || agentType || "agent") +
      (model ? ` ${C.dim(model)}${effortPart(task.model, task.effort)}` : ""),
    task.tokenCount > 0 && contextPart(task.tokenCount, limit, now),
    Number.isFinite(start) && C.dim(minutes(now - start)),
  ]
    .filter(Boolean)
    .join(SEP);
  const room = columns - width(line) - width(SEP);
  const desc = String(task.description ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!desc || room <= 8) return line;
  return (
    line +
    SEP +
    C.dim(desc.length > room ? `${desc.slice(0, room - 1)}…` : desc)
  );
}
