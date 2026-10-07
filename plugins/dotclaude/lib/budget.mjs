// dotclaude's bounds. A test keeps the copies of these numbers in step with
// this file.

/** Time that one Betterleaks scan can take. A scan takes about 30 ms. */
export const SECRET_SCAN_TIMEOUT_MS = 8000;

/** Output size at which the secret scan stops. Larger output goes unscanned. */
export const SECRET_SCAN_MAX_BYTES = 64 * 1024 * 1024;

/**
 * The CodeGraph augment of a search: time for one `codegraph` call (a call
 * takes about 250 ms), time for one `codegraph sync` (12 changed files took
 * 0.6 s), time for one `codegraph index` of an index in an old format
 * (1,296 files took 5 s), index matches that the hook reads to find the
 * definition of a name, callers and callees for each symbol, and characters
 * of the note.
 */
export const CODEGRAPH_TIMEOUT_MS = 3000;
export const CODEGRAPH_SYNC_TIMEOUT_MS = 10000;
export const CODEGRAPH_INDEX_TIMEOUT_MS = 30000;
export const CODEGRAPH_QUERY_LIMIT = 5;

/**
 * The preferred tokens per line of `sembr`. Its defaults (8 and 10) break at
 * each phrase, and a semantic line break is at a sentence or a clause.
 * The first run of `sembr` loads its model, so the timeout is long.
 * The line-break note shows at most this many blocks.
 */
export const SEMBR_MIN_TOKENS = 15;
export const SEMBR_MAX_TOKENS = 30;
export const SEMBR_TIMEOUT_MS = 15000;
export const LINE_BREAK_NOTE_MAX_BLOCKS = 5;
export const CODEGRAPH_NEIGHBOURS = 3;
export const CODEGRAPH_NOTE_MAX_CHARS = 1500;

/**
 * The project AI policy guard: time for one `gh api` read of a policy file
 * (a read takes about 0.5 s), characters of each file in the note and in the
 * ask reason, and paths of a Bash command that the guard checks.
 */
export const POLICY_FETCH_TIMEOUT_MS = 3000;
export const POLICY_FILE_MAX_CHARS = 4000;
export const POLICY_REASON_MAX_CHARS = 1000;
export const POLICY_PATHS_MAX = 4;

/** Characters of a command part that an ask reason shows. */
export const COMMAND_PART_CHARS = 80;

/**
 * The effort levels that a subagent model allows, by model key (see
 * `modelKey` in `guards/agents.mjs`). Haiku 4.5 takes no effort. Fable 5.1 has
 * no entry, because a subagent never runs on it.
 * `tests/agents.test.mjs` keeps the agent files in step with this table.
 */
export const SUBAGENT_EFFORTS = {
  "opus-5-5": ["low", "medium", "high"],
  "sonnet-5-5": ["low", "medium"],
  "haiku-4-5": [],
};

/** Bytes of the rendered section 1 of the operating spec for the main agent. A test fails above this number. */
export const RULES_MAX_BYTES = 2000;

/** Bytes of the rendered section 2 of the operating spec. A test fails above this. */
export const MINIMAL_CODE_MAX_BYTES = 800;

/** Bytes of all agent files together, because each spawn sends its agent body. A test fails above this. */
export const AGENTS_MAX_BYTES = 32000;

/**
 * Time after the last turn at which the main prompt cache has expired. The
 * cache lives 1 hour on a subscription and 5 minutes on an API key, a cloud
 * provider, or usage credits (`wiki/Plans-and-Models.md`).
 * `lib/plan.mjs` picks one by plan.
 */
export const CACHE_TTL_MS = 60 * 60_000;
export const API_CACHE_TTL_MS = 5 * 60_000;

/**
 * Context below which a resume with an expired cache gets no note.
 * The cache write of a small context costs little, so the note would only add noise.
 */
export const COLD_RESUME_MIN_TOKENS = 100_000;

/** Time that the handoff fork of a compaction can take. */
export const HANDOFF_FORK_TIMEOUT_MS = 60_000;

/** Sessions whose newest compaction note the store keeps, so the next note supersedes it. */
export const HANDOFF_SESSIONS_MAX = 20;

/** Main-conversation context: the `autoCompactWindow` of the settings profile. */
export const MAIN_CONTEXT_TOKENS = 150_000;

/**
 * Tokens at which Claude Code compacts with `autoCompactWindow` at
 * MAIN_CONTEXT_TOKENS: the window, minus 20k for output, minus a 13k buffer.
 * Subagents compact at the same point: in 914 subagent runs (2026-09-28 to
 * 2026-10-05), the peak context was at most about 117k, with one exception.
 */
export const AUTO_COMPACT_TOKENS = MAIN_CONTEXT_TOKENS - 33_000;

/** Usage percent where a value turns yellow, then red. */
export const USAGE_LEVELS = [75, 90];

/**
 * Seconds between forced status line runs (`refreshInterval`, minimum 1).
 * The warning glyphs blink once per second, so a slower interval skips frames.
 * `skills/setup/scripts/settings.mjs` holds a copy, and a test pins it.
 */
export const STATUS_REFRESH_SECONDS = 1;

/**
 * Time that the status line reuses a slow result (`git status`, the compaction
 * count, the usage copy). It runs every `STATUS_REFRESH_SECONDS`, so each of
 * those runs once per this time and not on each run.
 */
export const STATUS_CACHE_MS = 5000;

/** `200k` style label for prose. */
export const k = (n) => `${Math.round(n / 1000)}k`;
