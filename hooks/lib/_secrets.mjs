// Secret redaction for tool output, with gitleaks as the detector.
//
// gitleaks runs from the temp directory so that a repository's own
// .gitleaks.toml or .gitleaksignore cannot turn detection off, and with
// --ignore-gitleaks-allow so that a `gitleaks:allow` comment in a file does not
// let its secret through. GITLEAKS_CONFIG from the user's environment still
// applies. A run takes about 30 ms.

import { spawnSync } from "node:child_process";
import os from "node:os";

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

export const gitleaksInstalled = () => Bun.which("gitleaks") !== null;

/**
 * Secrets that gitleaks finds in `text`, as `[{rule, secret}]`, or null when
 * gitleaks is missing or fails.
 */
export function scan(text) {
  if (!text || !gitleaksInstalled()) return null;
  const res = spawnSync("gitleaks", ARGS, {
    input: text,
    encoding: "utf8",
    cwd: os.tmpdir(),
    timeout: 8000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) return null;
  try {
    const report = JSON.parse(res.stdout || "[]");
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
