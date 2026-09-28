// dotclaude's usage bounds, sized for Claude Pro and applied on every plan:
// larger plans only reach their limits later. The output style, the session
// notes, and the settings profile repeat these numbers; a test keeps them in
// step with this file.

/** Main-conversation context (tokens) at which to hand off or compact. */
export const MAIN_CONTEXT_TOKENS = 200_000;

/**
 * Subagent context (tokens) at which tool calls are refused and the agent
 * reports. In the week of 2026-09-21, 83% of implementer and 85% of
 * general-purpose cost came from calls above 100k.
 */
export const SUBAGENT_CONTEXT_TOKENS = 150_000;

/**
 * Growth allowed over a run's first call when that call is already large
 * (a fork starts with the parent's context).
 */
export const SUBAGENT_CONTEXT_GROWTH = 50_000;

/** Subagents, and agents in one workflow, running at once. */
export const MAX_CONCURRENT_AGENTS = 3;

/** `200k` style label for prose. */
export const k = (n) => `${Math.round(n / 1000)}k`;
