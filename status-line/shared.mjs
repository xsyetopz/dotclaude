// Helpers that both status lines use. It imports only the bounds in `hooks/lib/_budget.mjs`.

import {
  AUTO_COMPACT_TOKENS,
  k,
  REVIEWER_CONTEXT_TOKENS,
  SUBAGENT_CONTEXT_TOKENS,
  USAGE_LEVELS,
} from "../hooks/lib/_budget.mjs";

export {
  AUTO_COMPACT_TOKENS,
  k,
  REVIEWER_CONTEXT_TOKENS,
  SUBAGENT_CONTEXT_TOKENS,
  USAGE_LEVELS,
};

const paint = (code) => (text) => `\x1b[${code}m${text}\x1b[0m`;
export const C = {
  dim: paint("2"),
  bold: paint("1"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
};
export const SEP = C.dim(" · ");

/** "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5". */
export function shortModel(id) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(
    String(id ?? ""),
  );
  if (!m) return String(id ?? "");
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[3] ? `${m[2]}.${m[3]}` : m[2]}`;
}

export function levelColor(pct) {
  if (pct >= USAGE_LEVELS[1]) return C.red;
  return pct >= USAGE_LEVELS[0] ? C.yellow : C.green;
}

/** "87k/117k ████░", colored by how full it is. */
export function contextPart(tokens, limit, cells = 5) {
  const color = levelColor((tokens / limit) * 100);
  const full = Math.round(Math.min(tokens / limit, 1) * cells);
  return `${color(`${k(tokens)}/${k(limit)}`)} ${color("█".repeat(full))}${C.dim("░".repeat(cells - full))}`;
}
