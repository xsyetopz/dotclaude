// Secret redaction for tool output, with Betterleaks as the detector
// (https://github.com/betterleaks/betterleaks).
// Betterleaks runs from the temp directory, so that the `.betterleaks.toml`
// or ignore file of a repository cannot turn detection off.
// The flag `--ignore-gitleaks-allow` stops an allow comment from letting a
// secret through. Live validation stays off, so no secret leaves the machine.

export const SCAN_ARGS = [
  "betterleaks",
  "stdin",
  "--no-banner",
  "--log-level",
  "error",
  "--exit-code",
  "0",
  "--ignore-gitleaks-allow",
  "--report-format",
  "json",
  "--report-path",
  "-",
];

/**
 * The secrets in the JSON report of Betterleaks, as `[{rule, secret}]`, or
 * null when the report is not valid.
 */
export function findingsOf(stdout) {
  try {
    return JSON.parse(stdout || "[]")
      .filter((f) => typeof f.Secret === "string" && f.Secret)
      .map((f) => ({ rule: String(f.RuleID || "secret"), secret: f.Secret }));
  } catch {
    return null;
  }
}

/** Every string inside a JSON value, in order. */
export function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) strings(v, out);
  return out;
}

/**
 * `value` with every found secret replaced by `[REDACTED:<rule>]` in each of
 * its strings, keeping its shape. Longer secrets go first, so a secret that
 * contains a shorter one is replaced whole. `count` is the number of
 * replacements.
 */
export function redact(value, findings) {
  const rules = new Map();
  for (const { rule, secret } of findings)
    if (!rules.has(secret)) rules.set(secret, rule);
  const order = [...rules.keys()].sort((a, b) => b.length - a.length);
  let count = 0;
  const walk = (v) => {
    if (typeof v === "string") {
      let s = v;
      for (const secret of order) {
        const parts = s.split(secret);
        if (parts.length === 1) continue;
        count += parts.length - 1;
        s = parts.join(`[REDACTED:${rules.get(secret)}]`);
      }
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, inner]) => [k, walk(inner)]),
      );
    return v;
  };
  return { value: walk(value), count };
}

/** The context note for `count` redactions of the rules in `findings`. */
export function redactionNote(count, findings) {
  const rules = [...new Set(findings.map((f) => `\`${f.rule}\``))].join(", ");
  return `This hook redacted ${count} secret${count === 1 ? "" : "s"} (${rules}) from this output to keep them private. Do not look for them. Refer to each by its variable or file name.`;
}
