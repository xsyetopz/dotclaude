// statusLine: reads Claude Code's status JSON on stdin and prints one row:
// model and effort, context against the compaction point, prompt cache
// expiry, and the 5-hour and weekly limits.

import fs from "node:fs";
import {
  AUTO_COMPACT_TOKENS,
  C,
  contextPart,
  levelColor,
  SEP,
  shortModel,
} from "./shared.mjs";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** The highest effort for each model family that the rules allow. Haiku has none. */
const MAX_EFFORT = { sonnet: "medium", opus: "high", haiku: null };

/** A warning when the effort is above the rule for the model, else null. */
export function effortWarning(modelId, level) {
  const family = /claude-([a-z]+)/i
    .exec(String(modelId ?? ""))?.[1]
    ?.toLowerCase();
  if (!level || !(family in MAX_EFFORT)) return null;
  const max = MAX_EFFORT[family];
  if (max !== null && EFFORTS.indexOf(level) <= EFFORTS.indexOf(max))
    return null;
  return C.red(`⚠ ${max ? `above ${max}` : "no effort"}`);
}

/** Minutes left, rounded up: "4m", "1h5m". */
const countdown = (ms) => {
  const min = Math.ceil(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)}h${min % 60}m` : `${min}m`;
};

/** The cache expiry that Claude Code sends: time left while warm, else cold. */
export function cachePart(cache, now) {
  if (!cache?.caching_observed) return null;
  if (cache.warm && cache.expires_at * 1000 > now)
    return C.green(`◷ ${countdown(cache.expires_at * 1000 - now)}`);
  return C.dim("◌ cold");
}

export function limitPart(label, window) {
  if (!Number.isFinite(window?.used_percentage)) return null;
  const pct = Math.round(window.used_percentage);
  return `${C.dim(label)} ${levelColor(pct)(`${pct}%`)}`;
}

export function render(data, now = Date.now()) {
  const parts = [];
  const model = shortModel(data.model?.id) || data.model?.display_name;
  const level = data.effort?.level;
  if (model) parts.push(C.bold(model) + (level ? ` ${C.dim(level)}` : ""));
  parts.push(effortWarning(data.model?.id, level));
  const tokens = data.context_window?.total_input_tokens;
  if (tokens > 0) parts.push(contextPart(tokens, AUTO_COMPACT_TOKENS));
  parts.push(cachePart(data.prompt_cache, now));
  parts.push(limitPart("5h", data.rate_limits?.five_hour));
  parts.push(limitPart("7d", data.rate_limits?.seven_day));
  return parts.filter(Boolean).join(SEP);
}

try {
  const data = JSON.parse(fs.readFileSync(0, "utf8"));
  console.log(render(data && typeof data === "object" ? data : {}));
} catch {
  console.log("");
}
