// Secret redaction for tool output, with Betterleaks as the detector
// (https://github.com/betterleaks/betterleaks). gitleaks stays a pre-commit
// tool, outside dotclaude.
//
// Betterleaks runs from the temp directory so that a repository's own
// .betterleaks.toml, .gitleaks.toml, or ignore file cannot turn detection off,
// and with --ignore-gitleaks-allow so that a `betterleaks:allow` or
// `gitleaks:allow` comment in a file does not let its secret through.
// BETTERLEAKS_CONFIG or GITLEAKS_CONFIG from the user's environment still
// applies. Live validation stays off, so no secret leaves the machine. A run
// takes about 30 ms.

const ARGS = [
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

/** True when Betterleaks starts. A reject means it is not installed. */
export async function scannerInstalled(io) {
  try {
    await io.run(["betterleaks", "version"], {
      cwd: io.tmp,
      timeoutMs: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Secrets that Betterleaks finds in `text`, as `[{rule, secret}]`, or null when
 * Betterleaks is missing or fails.
 */
export async function scan(io, text) {
  if (!text) return null;
  // The host resolves the name. A reject (no binary, or a timeout) and a
  // nonzero exit both mean no scan.
  let stdout = null;
  try {
    const result = await io.run(["betterleaks", ...ARGS], {
      cwd: io.tmp,
      stdin: text,
      timeoutMs: 8000,
      maxBytes: 64 * 1024 * 1024,
    });
    if (result.exitCode === 0) stdout = result.stdout;
  } catch {
    // Betterleaks is missing, or it passed the timeout or the output cap.
  }
  if (stdout === null) return null;
  try {
    const report = JSON.parse(stdout || "[]");
    return report
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
  const bySecret = new Map();
  for (const { rule, secret } of findings)
    if (!bySecret.has(secret)) bySecret.set(secret, rule);
  const order = [...bySecret.keys()].sort((a, b) => b.length - a.length);
  let count = 0;
  const walk = (v) => {
    if (typeof v === "string") {
      let s = v;
      for (const secret of order) {
        const parts = s.split(secret);
        if (parts.length === 1) continue;
        count += parts.length - 1;
        s = parts.join(`[REDACTED:${bySecret.get(secret)}]`);
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
