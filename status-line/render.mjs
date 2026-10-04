// Both status lines. They choose the parts and their priorities. The parts
// are in `parts.mjs`, the look in `paint.mjs`, and the rows in `layout.mjs`.

import {
  AUTO_COMPACT_TOKENS,
  REVIEWER_CONTEXT_TOKENS,
  SUBAGENT_CONTEXT_TOKENS,
  USAGE_LEVELS,
} from "../hooks/lib/_budget.mjs";
import { minutes, shortModel } from "./format.mjs";
import { fitRows } from "./layout.mjs";
import { C, ICON, SEP, width } from "./paint.mjs";
import {
  cacheDetail,
  cacheExpiry,
  contextPart,
  effortPart,
  extraPart,
  folderPart,
  gitPart,
  limitPart,
  prPart,
  resetsPart,
} from "./parts.mjs";

/** At most this many rows. Past it, the lowest-priority parts go first. */
const MAX_ROWS = 3;

/**
 * The main status line, in three groups. `core` is the session: model,
 * context, and cache. `quota` is the usage: each window with its pace and
 * reset, limit resets, and extra usage. `place` is where it works, and then
 * the `detail` for power users: cache hit ratio and misses, cost, lines, and
 * time. Parts carry a priority, and past `MAX_ROWS` rows the lowest go first.
 * `o` has the clock `now`, `columns`, and what `sources.mjs` read: `git`,
 * `loop`, `compactions`, and `usage` (windows for a status JSON without
 * them, `resets`, and `extra`).
 */
export function renderMain(data, o = {}) {
  const { now = Date.now(), columns = 120 } = o;
  const [core, quota, place, detail] = [[], [], [], []];
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
    add(detail, 5, cacheDetail(cache));
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
    // A limit past the first level outranks all but the context.
    const urgent = window.used_percentage >= USAGE_LEVELS[0];
    add(quota, urgent ? 9 : priority, limitPart(label, window, now, span));
  }
  if (resets) {
    // A reset refills a window at its limit, so there it outranks the window.
    const atLimit = Object.values(limits).some(
      (w) => w?.used_percentage >= USAGE_LEVELS[1],
    );
    add(quota, atLimit ? 9 : 4, resetsPart(resets, now));
  }
  add(quota, 4, extra && extraPart(extra));
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
  add(place, 6, o.git?.branch && gitPart(o.git));
  const worktree = data.worktree?.name || data.workspace?.git_worktree;
  add(place, 5, worktree && C.cyan(`${ICON.worktree} ${worktree}`));
  add(place, 3, data.pr?.number && prPart(data.pr));
  add(place, 4, o.loop && C.cyan(`loop ${o.loop.done}/${o.loop.total}`));
  add(place, 4, data.agent?.name && C.magenta(`@${data.agent.name}`));
  add(place, 3, data.vim?.mode && C.bold(data.vim.mode));
  const name = data.session_name;
  if (name)
    add(place, 1, C.dim(name.length > 32 ? `${name.slice(0, 31)}…` : name));

  return fitRows([core, quota, place.concat(detail)], columns, MAX_ROWS).join(
    "\n",
  );
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
