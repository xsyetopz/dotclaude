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
 * to 2026-09-30 had a median of 121k tokens and a minimum of 116k.
 */
export const CONTEXT_NOTE_TOKENS = 100_000;

/**
 * Main-conversation context (tokens) at which the status line shows a cold
 * cache in red: the next turn writes the whole context to the cache again, at 1.25x the input price instead of reads at 0.05x on
 * Opus 5.5.
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
 * The context bound for the read-only reviewers. A review finds defects that
 * cross files only while the whole change is in view, and a fresh reviewer
 * writes that view to the cache again. With the 150k bound, 1 of 14
 * code-reviewer runs from 2026-09-28 to 2026-09-29 reached it.
 */
export const REVIEWER_CONTEXT_TOKENS = 150_000;

const REVIEWERS = new Set([
  "code-reviewer",
  "security-reviewer",
  "plan-reviewer",
]);

/** The context bound for a subagent type, with or without its plugin prefix. */
export const subagentContextTokens = (agentType) =>
  REVIEWERS.has(String(agentType ?? "").replace(/^dotclaude:/, ""))
    ? REVIEWER_CONTEXT_TOKENS
    : SUBAGENT_CONTEXT_TOKENS;

/**
 * Growth allowed over a run's first call when that call is already large
 * (a fork starts with the parent's context).
 */
export const SUBAGENT_CONTEXT_GROWTH = 50_000;

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
 * - outputStyleTokens: the output style loads into every main turn. It
 *   measured 515 tokens in 0.13.0, inside the ~900-token rule set that the
 *   plan targets, so the ceiling keeps it there.
 * - skillDescriptionChars: the description and `when_to_use` of one skill.
 *   Claude Code lists them in every main turn. They were 190 to 540
 *   characters before 0.13.0 and 150 to 230 after the cut.
 * - The rest are dotclaude's own files.
 */
export const LIMITS = {
  instructionLines: { warn: 150, fail: 200 },
  startupInstructionTokens: { warn: 3000, fail: 5000 },
  instructionFileBytes: { fail: 4 * 1024 * 1024 },
  importHops: { fail: 4 },
  skillLines: { warn: 450, fail: 500 },
  skillBodyTokens: { warn: 4500, fail: 5000 },
  skillDescriptionChars: { fail: 250 },
  outputStyleTokens: { warn: 700, fail: 900 },
  agentBodyTokens: { warn: 2000, fail: 5000 },
  systemPromptTokens: { warn: 5000, fail: 15000 },
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
