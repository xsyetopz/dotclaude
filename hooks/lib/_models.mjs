// Model allowlist matching, following availableModels semantics: an entry is
// a family alias (`opus`), a version prefix (`claude-opus-5-5` also matches
// `claude-opus-5-5-20260901`), or a full model ID.

export const DEFAULT_ALLOWED =
  "claude-opus-5-5,claude-sonnet-5-5,claude-fable-5-1,claude-haiku-4-5";
const FAMILIES = new Set(["opus", "sonnet", "haiku", "fable", "mythos"]);
const ALWAYS = new Set(["", "inherit", "default"]);

export function canonical(model) {
  let m = String(model).trim().toLowerCase();
  if (m.endsWith("[1m]")) m = m.slice(0, -4);
  const idx = m.indexOf("claude-");
  if (idx > 0) m = m.slice(idx); // provider IDs such as us.anthropic.claude-opus-5-5-v1:0
  return m;
}

/**
 * The model a family alias runs as. Claude Code resolves `sonnet`, `haiku`,
 * and friends through ANTHROPIC_DEFAULT_<FAMILY>_MODEL when it is set, so an
 * alias mapped to another model is checked as that model. `env` is the host
 * environment, `io.env`.
 */
function resolveAlias(m, env) {
  if (!FAMILIES.has(m)) return m;
  const mapped = env[`ANTHROPIC_DEFAULT_${m.toUpperCase()}_MODEL`];
  return mapped?.trim() ? canonical(mapped) : m;
}

/**
 * The effort levels that dotclaude supports for each model family. A family
 * that is not listed has no effort limit here. Sonnet 5.5 at `xhigh` and `max`
 * costs more than Opus 5.5 one level lower for a score that is not higher
 * (Anthropic launch charts, 2026-09-28). Sonnet 5.5 at `high` costs about as
 * much as Opus 5.5 one level lower for about the same score, so it stays
 * supported. `max` uses about 5.5x the usage on Opus 5.5 (claude.ai effort
 * picker).
 */
export const EFFORT_LEVELS = {
  opus: ["low", "medium", "high", "xhigh"],
  sonnet: ["low", "medium", "high"],
};

/** The family (`opus`, `sonnet`, ...) of a model alias or ID, or "". */
export function family(model, env = {}) {
  const m = resolveAlias(canonical(model), env);
  if (FAMILIES.has(m)) return m;
  return /^claude-([a-z]+)/.exec(m)?.[1] ?? "";
}

/** The supported effort levels of a model, or null when it has no limit. */
export function effortLevels(model, env = {}) {
  return EFFORT_LEVELS[family(model, env)] ?? null;
}

export function allowed(model, allowlist, env = {}) {
  const m = resolveAlias(canonical(model), env);
  if (ALWAYS.has(m)) return true;
  const entries = allowlist.map(canonical);
  if (FAMILIES.has(m))
    return entries.some((e) => e === m || e.startsWith(`claude-${m}`));
  if (m === "opusplan")
    return allowed("sonnet", allowlist, env) && allowed("opus", allowlist, env);
  return entries.some(
    (e) =>
      (FAMILIES.has(e) && m.startsWith(`claude-${e}`)) ||
      m === e ||
      [`${e}-`, `${e}:`, `${e}@`].some((prefix) => m.startsWith(prefix)),
  );
}
