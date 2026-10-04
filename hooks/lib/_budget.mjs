// dotclaude's bounds. A test keeps the copies of these numbers in step with
// this file.

/**
 * Lines of runtime JavaScript for the whole 0.20.0 release: all `.mjs` files
 * under `hooks/`, `status-line/`, `skills/`, and `plugins/`.
 * `tests/budget.test.mjs` fails above this number.
 */
export const RUNTIME_JS_LINES = 3000;

/** Time that one Betterleaks scan can take. A scan takes about 30 ms. */
export const SECRET_SCAN_TIMEOUT_MS = 8000;

/** Output size at which the secret scan stops. Larger output goes unscanned. */
export const SECRET_SCAN_MAX_BYTES = 64 * 1024 * 1024;

/** Characters of a command part that an ask reason shows. */
export const COMMAND_PART_CHARS = 80;

/**
 * The effort levels that a subagent model allows, by model key (see
 * `modelKey` in `_agent-rules.mjs`). Haiku 4.5 takes no effort. Fable 5.1 has
 * no entry, because a subagent never runs on it.
 * `tests/agents.test.mjs` keeps the agent files in step with this table.
 */
export const SUBAGENT_EFFORTS = {
  "opus-5-5": ["low", "medium", "high"],
  "sonnet-5-5": ["low", "medium"],
  "haiku-4-5": [],
};

/** Bytes of `hooks/session-start/rules.md`. A test fails above this number. */
export const RULES_MAX_BYTES = 2000;

/**
 * Time after the last turn at which the prompt cache has expired. The cache
 * lives 1 hour on a subscription and 5 minutes otherwise. dotclaude does not
 * detect the plan, so it uses the longer time and warns less often.
 */
export const CACHE_TTL_MS = 60 * 60_000;

/** Time that the handoff fork of a compaction can take. */
export const HANDOFF_FORK_TIMEOUT_MS = 60_000;

/** Main-conversation context: the `autoCompactWindow` of the settings profile. */
export const MAIN_CONTEXT_TOKENS = 150_000;

/**
 * Tokens at which Claude Code compacts with `autoCompactWindow` at
 * MAIN_CONTEXT_TOKENS: the window, minus 20k for output, minus a 13k buffer.
 */
export const AUTO_COMPACT_TOKENS = MAIN_CONTEXT_TOKENS - 33_000;

/** Context bounds of a subagent, and of the `reviewer`. */
export const SUBAGENT_CONTEXT_TOKENS = 100_000;
export const REVIEWER_CONTEXT_TOKENS = 150_000;

/** Usage percent where a value turns yellow, then red. */
export const USAGE_LEVELS = [75, 90];

/** `200k` style label for prose. */
export const k = (n) => `${Math.round(n / 1000)}k`;
