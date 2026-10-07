// The usage bounds of dotclaude, in one place.
// Tests pin the copies in `templates/settings.json` and in the agent files to these values,
// so change a bound here and nowhere else.

/**
 * The context window in tokens.
 * The profile sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to it,
 * which Claude Code honors only together with `DISABLE_COMPACT=1`.
 * At this size the session stops with `blocking_limit`, and does not compact.
 * The profile also sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to it.
 * Without it, Claude Code 2.1.292 shows and warns against a 200K window for Opus 5.5,
 * because that model is on its "billed past 200K" list.
 */
export const CONTEXT_WINDOW = 300_000;

/** The status line shows the context in yellow from the first and in red from the second percentage of `CONTEXT_WINDOW`. */
export const USAGE_LEVELS = [75, 90];

/** The effort levels that a subagent can set, for each model. A model with none takes no `effort`. */
export const SUBAGENT_EFFORTS = {
  "opus-5-5": ["low", "medium", "high", "xhigh", "max"],
  "sonnet-5-5": ["low", "medium", "high", "xhigh", "max"],
  "haiku-4-5": [],
};

/** The model, effort, and `maxTurns` of each agent. */
export const AGENTS = {
  investigator: ["claude-sonnet-5-5", "medium", 60],
  "web-researcher": ["claude-sonnet-5-5", "medium", 60],
  implementer: ["claude-sonnet-5-5", "medium", 80],
  debugger: ["claude-sonnet-5-5", "medium", 60],
  reviewer: ["claude-opus-5-5", "high", 60],
  "test-runner": ["claude-haiku-4-5", null, 20],
};

/** The bytes of the output style, which goes into each request. */
export const STYLE_MAX_BYTES = 6_000;

/** The time for one `gh` call of the policy guard. */
export const POLICY_TIMEOUT_MS = 5_000;

/** The characters of one policy file in the ask prompt. */
export const POLICY_FILE_MAX_CHARS = 2_000;
