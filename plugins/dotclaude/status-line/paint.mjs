// The look that every part shares: one icon set (`ICON`), one color scale
// for percent (green, yellow at the first `USAGE_LEVELS` value, red at the
// second), one bar, and one part shape, `icon bar number`. A warning glyph
// blinks from the clock that the caller passes, so the 1 second refresh
// animates it. No emoji, because an emoji takes two columns in some
// terminals and one in others, and the row packing counts columns.

import { USAGE_LEVELS } from "../lib/budget.mjs";

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
export const SEP = C.dim(" · ");

/** Visible width: colors and links take no columns. */
export const width = (text) => [...Bun.stripANSI(text)].length;

/** The one color scale for a percent that grows toward a limit. */
export function levelColor(pct) {
  if (pct >= USAGE_LEVELS[1]) return C.red;
  return pct >= USAGE_LEVELS[0] ? C.yellow : C.green;
}

/** True in the "on" half of each second. The caller passes the clock. */
export const blinkOn = (now) => Math.floor(now / 1000) % 2 === 0;

/**
 * A `⚠` that blinks red and dim while `urgent`. A dim glyph, not a space,
 * shows when off, so that no gap opens after a separator.
 */
export const alarm = (urgent, now) =>
  urgent ? `${(blinkOn(now) ? C.red : C.dim)(ICON.warn)} ` : "";

/** The one bar: five cells, filled by `pct`, colored by the scale. */
export function bar(pct, cells = 5) {
  const full = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * cells);
  return `${levelColor(pct)("█".repeat(full))}${C.dim("░".repeat(cells - full))}`;
}

/** The one part shape: `label bar number`, colored by the scale. */
export const meter = (label, pct, text) =>
  `${label} ${bar(pct)} ${levelColor(pct)(text)}`;
