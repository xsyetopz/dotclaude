#!/usr/bin/env bun
// Summarize a `claude plugin eval --json` result with error bars.
//
//   bun plugins/dotclaude/evals/report.mjs <result.json> [--before <result.json>]
//
// A trial passes when every scored grader passed. Per case it prints trials
// passed out of trials run, a 95% Wilson interval for that pass rate, and
// pass^k (every one of k trials passing, estimated as p^k), and how often
// each grader failed. Suite means use standard errors clustered by case,
// since trials of one case are not independent. With a no-plugin arm, or
// with --before, it also prints the paired per-case difference (see
// anthropic.com/research/
// statistical-approach-to-model-evals and
// anthropic.com/engineering/demystifying-evals-for-ai-agents). Per arm it
// prints the cost per pass and, after `evals/oracle.mjs`, the token split.

import fs from "node:fs";
import path from "node:path";

const Z = 1.96;

export function trialPassed(run, skip = new Set()) {
  const scored = run.graders.filter(
    (g) => g.scored !== false && !skip.has(g.name),
  );
  return scored.length > 0 && scored.every((g) => g.passed);
}

// Graders marked `arm: with-only` in their files. The result JSON does not
// always carry that mark, so a no-plugin comparison reads it from the case.
export function withOnlyGraders(caseDir) {
  const dir = path.join(caseDir, "graders");
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs
      .readdirSync(dir)
      .filter((f) =>
        /^arm:\s*with-only\s*$/m.test(
          fs.readFileSync(path.join(dir, f), "utf8"),
        ),
      )
      .map((f) => f.replace(/\.md$/, "")),
  );
}

export function wilson(k, n) {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (Z * Z) / n;
  const centre = (p + (Z * Z) / (2 * n)) / d;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// Mean and standard error of per-case values: the clustered standard error
// when each value is one case's pass rate.
export function meanSe(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, se: Number.NaN };
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { mean, se: Math.sqrt(variance / n) };
}

const warned = new Set();

// Failed-grader counts over `runs`, such as "format 2, works 1", or "".
export function failedGraders(runs) {
  const counts = new Map();
  for (const run of runs)
    for (const g of run.graders ?? [])
      if (g.scored !== false && !g.passed)
        counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
  return [...counts].map(([name, n]) => `${name} ${n}`).join(", ");
}

// Pass counts per case. With `shared`, graders only the plugin arm can pass
// are left out, and a case left with none is skipped.
export function armRates(result, arm, root, shared = false) {
  const rates = new Map();
  for (const c of result.cases) {
    const runs = c.arms[arm] ?? [];
    if (!runs.length) continue;
    const caseDir = path.resolve(root, c.dir ?? "");
    if (shared && !fs.existsSync(caseDir) && !warned.has(caseDir)) {
      warned.add(caseDir);
      console.error(
        `No case files for ${c.name} at ${caseDir}, so its with-only graders count in both arms.`,
      );
    }
    const skip = shared ? withOnlyGraders(caseDir) : new Set();
    if (shared && runs[0].graders.every((g) => skip.has(g.name))) continue;
    const k = runs.filter((r) => trialPassed(r, skip)).length;
    rates.set(c.name, { k, n: runs.length });
  }
  return rates;
}

// Cost per pass: the agent spend of every trial, failures included, divided
// by the trials that passed. Judge cost is left out. Token means need the
// `tokens` that `evals/oracle.mjs` adds.
export function armCost(result, arm) {
  let spend = 0;
  let passes = 0;
  const runs = result.cases.flatMap((c) => c.arms[arm] ?? []);
  for (const run of runs) {
    spend += run.costUsd ?? 0;
    if (trialPassed(run)) passes += 1;
  }
  const counted = runs.filter((r) => r.tokens);
  const tokens = counted.length
    ? Object.fromEntries(
        ["input", "output", "cacheRead", "cacheWrite"].map((k) => [
          k,
          Math.round(
            counted.reduce((s, r) => s + r.tokens[k], 0) / counted.length,
          ),
        ]),
      )
    : null;
  return {
    trials: runs.length,
    passes,
    spend,
    perPass: passes ? spend / passes : null,
    tokens,
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (x) => `${x >= 0 ? "+" : "-"}${pct(Math.abs(x))}`;

function paired(label, a, b) {
  const names = [...a.keys()].filter((name) => b.has(name));
  if (!names.length) return;
  const diffs = names.map(
    (name) => a.get(name).k / a.get(name).n - b.get(name).k / b.get(name).n,
  );
  const { mean, se } = meanSe(diffs);
  const ci = Number.isNaN(se)
    ? "no CI with one case"
    : `95% CI ${signed(mean - Z * se)} to ${signed(mean + Z * se)}`;
  console.log(
    `\n${label}: ${signed(mean)} mean pass-rate difference over ${names.length} case${names.length === 1 ? "" : "s"}, ${ci}`,
  );
  for (const [i, name] of names.entries())
    if (diffs[i] !== 0) console.log(`  ${name}: ${signed(diffs[i])}`);
}

function main(argv) {
  const [file, flag, beforeFile] = argv;
  if (!file || (flag && flag !== "--before")) {
    console.error(
      "Usage: bun plugins/dotclaude/evals/report.mjs <result.json> [--before <result.json>]",
    );
    process.exit(2);
  }
  const result = JSON.parse(fs.readFileSync(file, "utf8"));
  const root = path.dirname(import.meta.dirname);
  const withRates = armRates(result, "with", root);

  console.log("case                      passed  95% CI      pass^k");
  for (const [name, { k, n }] of withRates) {
    const [lo, hi] = wilson(k, n);
    const runs = result.cases.find((c) => c.name === name).arms.with;
    const failed = failedGraders(runs);
    console.log(
      `${name.padEnd(25)} ${`${k}/${n}`.padStart(6)}  ${`${pct(lo)}-${pct(hi)}`.padEnd(10)}  ${pct((k / n) ** n).padEnd(6)}${failed ? `  failed: ${failed}` : ""}`,
    );
  }
  const { mean, se } = meanSe([...withRates.values()].map(({ k, n }) => k / n));
  console.log(
    Number.isNaN(se)
      ? `\nsuite: ${pct(mean)} of trials pass. A clustered SE needs 2 or more cases.`
      : `\nsuite: ${pct(mean)} of trials pass, clustered SE ${pct(se)}, 95% CI ${pct(Math.max(0, mean - Z * se))}-${pct(Math.min(1, mean + Z * se))}`,
  );

  for (const arm of ["with", "without"]) {
    const c = armCost(result, arm);
    if (!c.trials) continue;
    const t = c.tokens;
    console.log(
      `${arm} plugin: $${c.spend.toFixed(2)} for ${c.passes} of ${c.trials} trials passed, ${c.perPass === null ? "no pass" : `$${c.perPass.toFixed(2)} per pass`}${t ? `. Mean tokens per trial: input ${t.input}, output ${t.output}, cache read ${t.cacheRead}, cache write ${t.cacheWrite}` : ""}`,
    );
  }

  const without = armRates(result, "without", root, true);
  if (without.size) {
    const shared = armRates(result, "with", root, true);
    paired("with plugin vs without", shared, without);
    const pluginOnly = [...withRates.keys()].filter((n) => !shared.has(n));
    if (pluginOnly.length)
      console.log(`  plugin-only, not compared: ${pluginOnly.join(", ")}`);
  }
  if (beforeFile) {
    const before = armRates(
      JSON.parse(fs.readFileSync(beforeFile, "utf8")),
      "with",
      root,
    );
    paired("this run vs --before", withRates, before);
  }
}

if (import.meta.main) main(process.argv.slice(2));
