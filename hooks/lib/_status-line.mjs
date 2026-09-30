// dotclaude's status lines. The main line measures the session against
// dotclaude's own bounds: context against the point where Claude Code
// compacts, not the model's window, with the compactions so far; the prompt cache's expiry and hit ratio; and the usage
// limits at the levels the usage notes use. The subagent rows measure each
// agent's context against the subagent budget.
//
// Each part is short and starts with a one-column glyph where a word would
// cost more columns: `⇊` compactions, `⎇` branch, `⊞` worktree, `◷` warm cache, `◌` cold
// cache, `✗` cache misses, `▲` limit deficit, `▼` limit reserve, `↻` limit
// reset. A space follows a glyph that labels a name or a time (`⎇`, `⊞`,
// `◷`, `◌`), so the glyph and the text do not run together. No emoji,
// because an emoji takes two columns in some terminals and one in others,
// and the row packing counts columns.
//
// A plugin can ship only `subagentStatusLine`. The main `statusLine` lives in
// the user's settings, so apply-statusline.mjs points it at a small stub at a
// fixed path, and session start keeps the stub pointing at this plugin
// version (the plugin's directory changes with every version). The plugin's
// `subagentStatusLine` runs a stub too: Claude Code leaves
// `${CLAUDE_PLUGIN_ROOT}` empty in that command, but sets CLAUDE_CONFIG_DIR.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AUTO_COMPACT_TOKENS,
  COMPACTIONS_BEFORE_HANDOFF,
  CONTEXT_NOTE_TOKENS,
  k,
  STALE_CACHE_CONTEXT_TOKENS,
  subagentContextTokens,
  USAGE_LEVELS,
} from "./_budget.mjs";
import { compactions } from "./_usage.mjs";

const ESC = "\x1b[";
const paint = (code) => (text) => `${ESC}${code}m${text}${ESC}0m`;
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

/** Visible width: ANSI colors and OSC 8 links take no columns. */
export function width(text) {
  // `Bun.stripANSI`, not `node:util`: loading `node:util` costs about 2 ms per
  // status line. The two differ only on escapes this file never writes.
  return [...Bun.stripANSI(text)].length;
}

const link = (url, text) => `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;

/** "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5". */
export function shortModel(id) {
  const m = /claude-([a-z]+)-(\d+(?:-\d+)?)/i.exec(String(id ?? ""));
  if (!m) return String(id ?? "");
  const [major, minor] = m[2].split("-");
  const version = minor && minor.length <= 2 ? `${major}.${minor}` : major;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${version}`;
}

/** Green, yellow at the first usage level, red at the second. */
function levelColor(pct) {
  const [warn, high] = USAGE_LEVELS;
  if (pct >= high) return C.red;
  if (pct >= warn) return C.yellow;
  return C.green;
}
const byLevel = (pct, text) => levelColor(pct)(text);

/**
 * Context tokens against `limit`, with a bar, and a handoff mark past it
 * unless `markPast` is false.
 */
export function contextPart(tokens, limit, cells = 5, markPast = true) {
  const fraction = tokens / limit;
  const color = levelColor(fraction * 100);
  const full = Math.round(Math.min(fraction, 1) * cells);
  let text = `${color(`${k(tokens)}/${k(limit)}`)} ${color("█".repeat(full))}${C.dim("░".repeat(cells - full))}`;
  if (markPast && fraction >= 1) text += ` ${C.red("handoff")}`;
  return text;
}

/**
 * The main context against the compaction point, and `⇊2/4` for the
 * compactions so far out of those before a handoff. `handoff` shows when the
 * context note asks for one.
 */
export function mainContextPart(tokens, count) {
  let text = contextPart(tokens, AUTO_COMPACT_TOKENS, 5, false);
  if (count > 0) {
    const color = count >= COMPACTIONS_BEFORE_HANDOFF ? C.red : C.dim;
    text += ` ${color(`⇊${count}/${COMPACTIONS_BEFORE_HANDOFF}`)}`;
  }
  if (count >= COMPACTIONS_BEFORE_HANDOFF && tokens >= CONTEXT_NOTE_TOKENS)
    text += ` ${C.red("handoff")}`;
  return text;
}

const clock = (sec, now) => {
  const d = new Date(sec * 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sec * 1000 - now < 20 * 3600_000) return hm;
  return d.toLocaleDateString("en-US", { weekday: "short" });
};

/** Time left, rounded up to whole minutes: "4m", "1h5m". */
const countdown = (ms) => {
  const min = Math.ceil(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)}h${min % 60}m` : `${min}m`;
};

/**
 * The prompt cache: the minutes until it goes cold, and the hit ratio. A
 * cold cache over the stale-cache bound is red, because the next turn
 * re-reads it all.
 */
export function cachePart(cache, now = Date.now()) {
  if (!cache?.caching_observed) return null;
  const hit =
    typeof cache.hit_ratio === "number"
      ? Math.round(cache.hit_ratio * 100)
      : null;
  // The cost guide: below about 80%, something is breaking the cache.
  let ratio =
    hit === null ? "" : ` ${(hit < 80 ? C.yellow : C.dim)(`${hit}%`)}`;
  // Misses tell an advanced user that something breaks the cache, and the
  // last cause tells them what. Idle time past the TTL breaks nothing, and the
  // expiry countdown shows it. A model switch starts a new cache, so its
  // rebuild is expected. Those misses do not count. Claude Code records a TTL
  // cause only when no other cause applies, and each miss adds 1 to each of
  // its causes, so subtracting these counts is exact. Claude Code itself
  // keeps the first call and the call after a compaction out of `misses`.
  const expected =
    (cache.miss_causes?.ttl_expired_5m ?? 0) +
    (cache.miss_causes?.ttl_expired_1h ?? 0) +
    (cache.miss_causes?.model_changed ?? 0);
  const misses = (cache.misses ?? 0) - expected;
  if (misses > 0) {
    const causes = cache.last_miss_cause?.causes ?? [];
    const cause = causes.includes("model_changed") ? null : causes[0];
    const shown =
      cause && !cause.startsWith("ttl_expired")
        ? ` ${cause.replace(/_changed$/, "")}`
        : "";
    ratio += ` ${C.yellow(`✗${misses}${shown}`)}`;
  }
  if (cache.warm && cache.expires_at && cache.expires_at * 1000 > now)
    return `${C.green(`◷ ${countdown(cache.expires_at * 1000 - now)}`)}${ratio}`;
  const recache = cache.recache_tokens_if_cold ?? 0;
  if (recache >= STALE_CACHE_CONTEXT_TOKENS)
    return `${C.red(`◌ cold ${k(recache)}`)}${ratio}`;
  return `${C.dim("◌ cold")}${ratio}`;
}

/**
 * The part of a usage window that is gone, from 0 to 1, or null when the
 * reset time does not fall inside a window of `span` seconds.
 */
function windowGone(window, now, span) {
  const left = Number(window.resets_at) - now / 1000;
  if (!(span > 0) || !(left >= 0) || left > span) return null;
  return (span - left) / span;
}

/**
 * One usage window: "5h 23%", with its reset time once it passes a level.
 * With the window length in seconds, it also shows the pace, as CodexBar
 * does: "▲12%→12:46" is a deficit (usage runs 12 points ahead of an even
 * rate, and at that rate the limit runs out at 12:46), and "▼30%" is a
 * reserve. Early in a window the pace is noise, so it shows only after 3%
 * of the window is gone.
 */
export function limitPart(label, window, now = Date.now(), span = 0) {
  if (!Number.isFinite(window?.used_percentage)) return null;
  const used = window.used_percentage;
  const pct = Math.round(used);
  const gone = windowGone(window, now, span);
  let pace = "";
  if (gone !== null && gone >= 0.03) {
    const delta = Math.round(used - 100 * gone);
    if (delta > 0 && used < 100) {
      const out = now / 1000 + ((100 - used) * gone * span) / used;
      pace = ` ${C.yellow(`▲${delta}%→${clock(out, now)}`)}`;
    } else if (delta > 0) pace = ` ${C.yellow(`▲${delta}%`)}`;
    else if (delta < 0) pace = ` ${C.green(`▼${-delta}%`)}`;
  }
  const reset =
    pct >= USAGE_LEVELS[0] && window.resets_at
      ? C.dim(` ↻${clock(window.resets_at, now)}`)
      : "";
  return `${C.dim(label)} ${byLevel(pct, `${pct}%`)}${pace}${reset}`;
}

/** Branch, dirty count, and ahead/behind from one `git status` call. */
export function gitState(dir) {
  const res = spawnSync(
    "git",
    ["--no-optional-locks", "-C", dir, "status", "--porcelain=v2", "--branch"],
    { encoding: "utf8", timeout: 1500 },
  );
  if (res.status !== 0 || !res.stdout) return null;
  let branch = null;
  let oid = null;
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  for (const line of res.stdout.split("\n")) {
    if (line.startsWith("# branch.head ")) branch = line.slice(14);
    else if (line.startsWith("# branch.oid ")) oid = line.slice(13, 20);
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) [ahead, behind] = [Number(m[1]), Number(m[2])];
    } else if (line && !line.startsWith("#")) dirty++;
  }
  return {
    branch: branch === "(detached)" ? oid : branch,
    dirty,
    ahead,
    behind,
  };
}

function gitPart(git) {
  if (!git?.branch) return null;
  let text = C.magenta(`⎇ ${git.branch}`);
  if (git.dirty) text += C.yellow(` ±${git.dirty}`);
  if (git.ahead) text += C.cyan(` ↑${git.ahead}`);
  if (git.behind) text += C.cyan(` ↓${git.behind}`);
  return text;
}

const REVIEW = {
  approved: C.green,
  changes_requested: C.red,
  draft: C.dim,
};

/** The folder, as `project/subdir` when the session moved below its project. */
function folderPart(workspace, dir) {
  const project = workspace?.project_dir;
  let name = path.basename(dir) || dir;
  if (project && dir !== project && dir.startsWith(project + path.sep))
    name = `${path.basename(project)}/${path.relative(project, dir)}`;
  let text = C.bold(C.blue(name));
  const added = workspace?.added_dirs?.length;
  if (added) text += C.dim(` +${added}`);
  return text;
}

const minutes = (ms) => {
  const min = Math.floor(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)}h${min % 60}m` : `${min}m`;
};

/** Lines added and removed this session: "+156 -23". */
function linesPart(cost) {
  const added = cost?.total_lines_added ?? 0;
  const removed = cost?.total_lines_removed ?? 0;
  if (!added && !removed) return null;
  return `${C.green(`+${added}`)} ${C.red(`-${removed}`)}`;
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
 * The main status line: where the session works on the first row, and what
 * it uses on the second. A row that is wider than `columns` wraps to the
 * next row, so no part is cut off. Parts carry a priority, and past
 * `MAX_ROWS` rows the lowest go first.
 */
export function renderMain(
  data,
  { columns = 120, now = Date.now(), git, loop } = {},
) {
  const dir = data.workspace?.current_dir || data.cwd || "";
  const place = [];
  const usage = [];
  const add = (group, priority, text) => {
    if (text) group.push({ priority, text });
  };

  add(place, 9, folderPart(data.workspace, dir));
  const worktree = data.worktree?.name || data.workspace?.git_worktree;
  if (worktree) add(place, 5, C.cyan(`⊞ ${worktree}`));
  add(place, 6, gitPart(git));
  if (data.pr?.number) {
    const color = REVIEW[data.pr.review_state] ?? C.yellow;
    const label = `${data.pr.kind === "mr" ? "!" : "#"}${data.pr.number}`;
    add(place, 3, color(data.pr.url ? link(data.pr.url, label) : label));
  }
  if (loop) add(place, 4, C.cyan(`loop ${loop.done}/${loop.total}`));
  if (data.agent?.name) add(place, 4, C.magenta(`@${data.agent.name}`));
  if (data.vim?.mode) add(place, 3, C.bold(data.vim.mode));
  if (data.session_name) {
    const name = data.session_name;
    add(place, 1, C.dim(name.length > 32 ? `${name.slice(0, 31)}…` : name));
  }

  let model = C.bold(shortModel(data.model?.id) || data.model?.display_name);
  if (data.effort?.level) model += ` ${C.dim(data.effort.level)}`;
  if (data.fast_mode) model += ` ${C.red("FAST")}`;
  add(usage, 8, model);

  const ctx = data.context_window?.total_input_tokens;
  if (typeof ctx === "number" && ctx > 0)
    add(usage, 10, mainContextPart(ctx, compactions(data.transcript_path)));

  add(usage, 7, cachePart(data.prompt_cache, now));
  // A limit past the first usage level outranks all but the context.
  const limit = (label, window, priority, span) =>
    add(
      usage,
      window?.used_percentage >= USAGE_LEVELS[0] ? 9 : priority,
      limitPart(label, window, now, span),
    );
  limit("5h", data.rate_limits?.five_hour, 5, 5 * 3600);
  limit("7d", data.rate_limits?.seven_day, 4, 7 * 86_400);
  // A spend limit has no fixed window, so it has no pace.
  limit("spend", data.rate_limits?.spend_limit, 4);
  // Subscribers see limits. Others pay per token, so they see the estimate.
  if (!data.rate_limits && typeof data.cost?.total_cost_usd === "number")
    add(usage, 3, C.dim(`$${data.cost.total_cost_usd.toFixed(2)}`));
  add(usage, 2, linesPart(data.cost));
  if (data.cost?.total_duration_ms > 0)
    add(usage, 1, C.dim(minutes(data.cost.total_duration_ms)));

  const groups = [place, usage];
  let rows = pack(groups, columns);
  while (rows.length > MAX_ROWS) {
    const all = groups.flat();
    if (all.length <= 1) break;
    const lowest = all.reduce((a, b) => (b.priority < a.priority ? b : a));
    for (const group of groups)
      if (group.includes(lowest)) group.splice(group.indexOf(lowest), 1);
    rows = pack(groups, columns);
  }
  return rows.join("\n");
}

function elapsed(startTime, now) {
  const start =
    typeof startTime === "number" ? startTime : Date.parse(startTime);
  if (!Number.isFinite(start)) return null;
  return minutes(now - start);
}

/**
 * One subagent row body: name, model and effort, context against the
 * subagent budget, and run time. The description fills what is left.
 */
export function renderTask(task, { columns = 100, now = Date.now() } = {}) {
  // `type` is the task kind ("local_agent"), so it is no name.
  const head = [C.bold(task.name || task.agentType || "agent")];
  const model = task.model ? shortModel(task.model) : "";
  const effort = typeof task.effort === "string" ? task.effort : "";
  if (model || effort)
    head.push(C.dim([model, effort].filter(Boolean).join(" ")));
  if (typeof task.tokenCount === "number" && task.tokenCount > 0)
    head.push(
      contextPart(
        task.tokenCount,
        subagentContextTokens(task.agentType ?? task.name),
      ),
    );
  const time = elapsed(task.startTime, now);
  if (time) head.push(C.dim(time));
  let line = head.join(SEP);
  const room = columns - width(line) - width(SEP);
  const desc = String(task.description ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (desc && room > 8)
    line +=
      SEP + C.dim(desc.length > room ? `${desc.slice(0, room - 1)}…` : desc);
  return line;
}

/**
 * A subagent's type without its plugin prefix ("dotclaude:test-runner" ->
 * "test-runner"). Claude Code's row input has no agent type, but the
 * agent's `.meta.json` next to the session transcript has it.
 */
export function agentTypeOf(transcriptPath, id) {
  if (!transcriptPath || !/^[A-Za-z0-9_-]+$/.test(String(id))) return null;
  const meta = path.join(
    transcriptPath.replace(/\.jsonl$/, ""),
    "subagents",
    `agent-${id}.meta.json`,
  );
  try {
    const type = JSON.parse(fs.readFileSync(meta, "utf8")).agentType;
    return typeof type === "string" ? type.replace(/^[^:]+:/, "") : null;
  } catch {
    return null;
  }
}

const configDir = (env) =>
  env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

/** The copy that the user's `statusLine` setting runs. */
export function installedStatusLine(env = process.env) {
  return path.join(configDir(env), "dotclaude", "statusline.mjs");
}

/** The copy that the plugin's `subagentStatusLine` setting runs. */
export function installedSubagentStatusLine(env = process.env) {
  return path.join(configDir(env), "dotclaude", "subagent-statusline.mjs");
}

export const MAIN_SCRIPT = path.resolve(
  import.meta.dir,
  "../status-line/main.mjs",
);

export const SUBAGENT_SCRIPT = path.resolve(
  import.meta.dir,
  "../status-line/subagents.mjs",
);

/**
 * A stub's text: it runs `script` from this plugin version. The subagent
 * stub prints nothing when the plugin is gone, so the rows keep Claude
 * Code's default rendering.
 */
export function stubText(script = MAIN_SCRIPT) {
  const missing =
    script === SUBAGENT_SCRIPT
      ? ""
      : '\n  console.log("dotclaude status line: plugin not found, restart Claude Code");';
  return `// Managed by dotclaude. Session start points this at the current plugin version.
try {
  await import(${JSON.stringify(pathToFileURL(script).href)});
} catch {${missing}
}
`;
}

/**
 * Seconds between forced re-runs, so an idle session's clock and session
 * time (minute resolution) do not go stale between events. Each run spawns
 * `bun` plus one `git status`; once a minute matches the display's own
 * resolution without spawning more often than that.
 */
const REFRESH_INTERVAL_SECONDS = 60;

/** The `statusLine` setting that runs the stub. */
export function statusLineSetting(stub = installedStatusLine()) {
  return {
    type: "command",
    command: `bun ${JSON.stringify(stub)}`,
    padding: 0,
    refreshInterval: REFRESH_INTERVAL_SECONDS,
  };
}

/**
 * Point an installed stub at this plugin version. A missing stub means the
 * status line is not installed, so it stays missing. Returns true when it
 * wrote.
 */
export function syncStatusLine(
  stub = installedStatusLine(),
  main = MAIN_SCRIPT,
) {
  let current;
  try {
    current = fs.readFileSync(stub, "utf8");
  } catch {
    return false;
  }
  const next = stubText(main);
  if (current === next) return false;
  fs.writeFileSync(stub, next);
  return true;
}

/**
 * Write the stub that the plugin's `subagentStatusLine` runs. The plugin
 * ships that setting, so the stub is always written. Returns true when it
 * wrote.
 */
export function syncSubagentStatusLine(stub = installedSubagentStatusLine()) {
  const next = stubText(SUBAGENT_SCRIPT);
  try {
    if (fs.readFileSync(stub, "utf8") === next) return false;
  } catch {
    fs.mkdirSync(path.dirname(stub), { recursive: true });
  }
  fs.writeFileSync(stub, next);
  return true;
}
