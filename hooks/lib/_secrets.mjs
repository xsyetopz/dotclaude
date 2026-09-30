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

export const scannerInstalled = () => Bun.which("betterleaks") !== null;

/**
 * Secrets that gitleaks finds in `text`, as `[{rule, secret}]`, or null when
 * gitleaks is missing or fails.
 */
export async function scan(text) {
  // `Bun.which` reads the start-up PATH unless it gets the current one.
  const bin = text
    ? Bun.which("betterleaks", { PATH: process.env.PATH ?? "" })
    : null;
  if (!bin) return null;
  // Async, so the dispatcher runs the other PostToolUse actions while
  // Betterleaks runs. `Bun.spawn`, not `node:child_process`: loading the
  // Node stream layer costs about 15 ms per hook run. A timeout or a full
  // buffer kills the child, which leaves `exitCode` null.
  let stdout = null;
  try {
    const child = Bun.spawn([bin, ...ARGS], {
      cwd: os.tmpdir(),
      stdin: new Blob([text]),
      stdout: "pipe",
      stderr: "ignore",
      timeout: 8000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const [out, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    if (code === 0) stdout = out;
  } catch {
    // Betterleaks went missing after the check, or the spawn failed.
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
