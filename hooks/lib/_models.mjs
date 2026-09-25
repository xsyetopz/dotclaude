// Model allowlist matching, following availableModels semantics: an entry is
// a family alias (`opus`), a version prefix (`claude-opus-5-5` also matches
// `claude-opus-5-5-20260901`), or a full model ID.

export const DEFAULT_ALLOWED = "claude-opus-5-5,claude-fable-5-1";
const FAMILIES = new Set(["opus", "sonnet", "haiku", "fable", "mythos"]);
const ALWAYS = new Set(["", "inherit", "default"]);

export function canonical(model) {
  let m = String(model).trim().toLowerCase();
  if (m.endsWith("[1m]")) m = m.slice(0, -4);
  const idx = m.indexOf("claude-");
  if (idx > 0) m = m.slice(idx); // provider IDs such as us.anthropic.claude-opus-5-5-v1:0
  return m;
}

export function allowed(model, allowlist) {
  const m = canonical(model);
  if (ALWAYS.has(m)) return true;
  const entries = allowlist.map(canonical);
  if (FAMILIES.has(m))
    return entries.some((e) => e === m || e.startsWith(`claude-${m}`));
  if (m === "opusplan")
    return allowed("sonnet", allowlist) && allowed("opus", allowlist);
  return entries.some(
    (e) =>
      (FAMILIES.has(e) && m.startsWith(`claude-${e}`)) ||
      m === e ||
      [`${e}-`, `${e}:`, `${e}@`].some((prefix) => m.startsWith(prefix)),
  );
}
