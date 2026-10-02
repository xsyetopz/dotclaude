// dotclaude's usage bounds, sized for Claude Pro and applied on every plan:
// larger plans only reach their limits later. The output style, the session
// notes, and the settings profile repeat these numbers; a test keeps them in
// step with this file.

/**
 * Main-conversation context (tokens) at which to hand off or compact. From
 * 2026-09-28 to 2026-09-29, with compaction at 200k, main-conversation calls
 * above 150k were 13% of all cost. Claude Code accepts 100k to 1M.
 */
export const MAIN_CONTEXT_TOKENS = 150_000;

/**
 * Main-conversation context (tokens) from which each user prompt tells Claude
 * its context size, so that it can hand off before automatic compaction.
 * With `autoCompactWindow` at MAIN_CONTEXT_TOKENS, Claude Code 2.1.284
 * compacts at the window minus 20k for output and 13k of buffer, so a
 * handoff at 150k comes too late: 145 automatic compactions in main sessions
 * to 2026-09-30 had a median of 121k tokens and a minimum of 116k. The note
 * comes only after COMPACTIONS_BEFORE_HANDOFF compactions.
 */
export const CONTEXT_NOTE_TOKENS = 100_000;

/**
 * Main-conversation context (tokens) at which Claude Code compacts with
 * `autoCompactWindow` at MAIN_CONTEXT_TOKENS: the window, minus 20k for
 * output, minus a 13k buffer. The status line measures the context against
 * it, because the context never reaches MAIN_CONTEXT_TOKENS.
 */
export const AUTO_COMPACT_TOKENS = MAIN_CONTEXT_TOKENS - 33_000;

/**
 * Compactions of the main conversation before the context note asks for a
 * handoff. A handoff and a compaction both start the next part from about
 * 20k tokens (170 automatic compactions from 2026-09-23 to 2026-09-30: median
 * 120k before, 20k after), so they cost about the same per turn. A handoff at
 * the first crossing of CONTEXT_NOTE_TOKENS stopped every long session near
 * 100k, and the user continued anyway. `scripts/compaction-report.mjs` on the
 * 7 sessions with the 150k window that passed 4 compactions, 2026-09-30:
 * the cost per call stayed at $0.05 to $0.06 in every part, but compactions
 * 1 to 4 kept 49% to 57% of the needed tokens and compactions 5 to 8 kept 42%.
 */
export const COMPACTIONS_BEFORE_HANDOFF = 4;

/**
 * Main-conversation context (tokens) at which the status line shows a cold
 * cache in red, and a resumed session with an expired cache tells the user:
 * the next turn writes the whole context to the cache again, at 2x the input
 * price for the 1-hour cache of a subscription (1.25x for the 5-minute cache)
 * instead of reads at 0.05x on Opus 5.5. One user measured that turns more
 * than an hour after the last one were 1.6% of turns and 80% of cache writes
 * (reported, 2026-10-01).
 */
export const STALE_CACHE_CONTEXT_TOKENS = 100_000;

/**
 * Subagent context (tokens) at which tool calls are refused and the agent
 * reports. In the week of 2026-09-21, 83% of implementer and 85% of
 * general-purpose cost came from calls above 100k. From 2026-09-28 to
 * 2026-09-29, with the bound at 150k, 34 of 69 implementer runs passed 100k,
 * and subagent calls from 100k to 150k were 9% of all cost.
 */
export const SUBAGENT_CONTEXT_TOKENS = 100_000;

/**
 * The context bound for the read-only `reviewer`. A review finds defects that
 * cross files only while the whole change is in view, and a fresh reviewer
 * writes that view to the cache again. With the 150k bound, 1 of 14
 * code-reviewer runs from 2026-09-28 to 2026-09-29 reached it.
 */
export const REVIEWER_CONTEXT_TOKENS = 150_000;

/** The context bound for a subagent type, with or without its plugin prefix. */
export const subagentContextTokens = (agentType) =>
  String(agentType ?? "").replace(/^dotclaude:/, "") === "reviewer"
    ? REVIEWER_CONTEXT_TOKENS
    : SUBAGENT_CONTEXT_TOKENS;

/**
 * Growth allowed over a run's first call when that call is already large
 * (a fork starts with the parent's context).
 */
export const SUBAGENT_CONTEXT_GROWTH = 50_000;

/**
 * Room under a subagent's context bound in which it gets one note to finish
 * its current item, delete its scratch files, and report. In session
 * ba7be763 on 2026-09-30, two of three audit agents stopped at the bound in
 * the middle of an item.
 */
export const SUBAGENT_WRAP_UP_TOKENS = 15_000;

/**
 * Usage-limit percentages at which the usage notes tell Claude and the status
 * line turns yellow, then red. Claude Code starts warning at 75%.
 */
export const USAGE_LEVELS = [75, 90];

/**
 * Characters of nested CLAUDE.md text that one Bash call may add to the
 * context (see hooks/post-tool-use/load-nested-instructions.mjs). A file
 * past it is named instead, for Claude to open with the Read tool.
 */
export const NESTED_INSTRUCTIONS_CHARS = 10_000;

/**
 * Subagents, and agents in one workflow, running at once. The community
 * figure is 5, and a cap of 3 caused 50 of 77 measured `Agent` errors.
 */
export const MAX_CONCURRENT_AGENTS = 5;

/**
 * Minutes with no change to a subagent's transcript or start marker after
 * which the agent no longer counts as running. An interrupted agent can end
 * without `SubagentStop`. In 127,283 measured gaps between two transcript
 * entries of one subagent, 26 passed 10 minutes.
 */
export const RUNNING_AGENT_IDLE_MINUTES = 10;

/**
 * Size limits for instruction text. A warn is reported. A fail is reported
 * as a failure, and dotclaude's own tests fail on it. Lines count newlines
 * plus a final line without one. Tokens are an estimate (see `tokens`).
 * Change a value only with the user's approval: fix the content instead.
 *
 * - instructionLines: each CLAUDE.md, CLAUDE.local.md, AGENTS.md, rule file,
 *   and import, after block-level HTML comments are removed. Claude Code
 *   targets 200.
 * - startupInstructionTokens: all instruction text that loads at session
 *   start together (the directory chain, the global file, imports, and rules
 *   without `paths:`).
 * - instructionFileBytes: Claude Code skips a larger file.
 * - importHops: Claude Code follows at most four `@path` hops.
 * - outputStyleTokens: the output style loads into every main turn. In 0.17.0
 *   it carries the rules that the 0.16 replacement system prompt held: 2.3k
 *   tokens against 4.3k plus 0.6k for the 0.16 prompt and style.
 * - sessionNoteChars: one note that a hook adds at every session or
 *   subagent start. In one week of 0.16 sessions, the subagent conventions
 *   (3.3k characters) were injected 746 times.
 * - The rest are dotclaude's own files.
 */
export const LIMITS = {
  instructionLines: { warn: 150, fail: 200 },
  startupInstructionTokens: { warn: 3000, fail: 5000 },
  instructionFileBytes: { fail: 4 * 1024 * 1024 },
  importHops: { fail: 4 },
  outputStyleTokens: { warn: 2300, fail: 2350 },
  agentBodyTokens: { warn: 2000, fail: 5000 },
  sessionNoteChars: { fail: 1000 },
};

/** Estimated tokens: the larger of chars / 4 and words / 0.75. */
export function tokens(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(Math.ceil([...text].length / 4), Math.ceil(words / 0.75));
}

/** Newlines, plus a final line without one. */
export const lineCount = (text) =>
  text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

/** "warn", "fail", or null for `value` against one entry of LIMITS. */
export function severity(value, limit) {
  if (value > limit.fail) return "fail";
  return limit.warn !== undefined && value > limit.warn ? "warn" : null;
}

/** `200k` style label for prose. */
export const k = (n) => `${Math.round(n / 1000)}k`;
