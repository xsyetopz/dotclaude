#!/usr/bin/env bun
// Summarize a `claude plugin eval --json` result with error bars.
//
//   bun evals/report.mjs <result.json> [--before <result.json>]
//
// A trial passes when every scored grader passed. Per case it prints trials
// passed out of trials run, a 95% Wilson interval for that pass rate, and
// pass^k (every one of k trials passing, estimated as p^k). Suite means use
// standard errors clustered by case, since trials of one case are not
// independent. With a no-plugin arm, or with --before, it also prints the
// paired per-case difference (see anthropic.com/research/
// statistical-approach-to-model-evals and
// anthropic.com/engineering/demystifying-evals-for-ai-agents).

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

// Pass counts per case. With `shared`, graders only the plugin arm can pass
// are left out, and a case left with none is skipped.
export function armRates(result, arm, root, shared = false) {
  const rates = new Map();
  for (const c of result.cases) {
    const runs = c.arms[arm] ?? [];
    if (!runs.length) continue;
    const skip = shared
      ? withOnlyGraders(path.resolve(root, c.dir ?? ""))
      : new Set();
    if (shared && runs[0].graders.every((g) => skip.has(g.name))) continue;
    const k = runs.filter((r) => trialPassed(r, skip)).length;
    rates.set(c.name, { k, n: runs.length });
  }
  return rates;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (x) => `${x >= 0 ? "+" : "-"}${pct(Math.abs(x))}`;

function paired(label, a, b) {
  const names = [...a.keys()].filter((name) => b.has(name));
  if (names.length < 2) return;
  const diffs = names.map(
    (name) => a.get(name).k / a.get(name).n - b.get(name).k / b.get(name).n,
  );
  const { mean, se } = meanSe(diffs);
  console.log(
    `\n${label}: ${signed(mean)} mean pass-rate difference over ${names.length} cases, 95% CI ${signed(mean - Z * se)} to ${signed(mean + Z * se)}`,
  );
  for (const [i, name] of names.entries())
    if (diffs[i] !== 0) console.log(`  ${name}: ${signed(diffs[i])}`);
}

function main(argv) {
  const [file, flag, beforeFile] = argv;
  if (!file || (flag && flag !== "--before")) {
    console.error(
      "Usage: bun evals/report.mjs <result.json> [--before <result.json>]",
    );
    process.exit(2);
  }
  const result = JSON.parse(fs.readFileSync(file, "utf8"));
  const root = path.dirname(import.meta.dirname);
  const withRates = armRates(result, "with", root);

  console.log("case                      passed  95% CI      pass^k");
  for (const [name, { k, n }] of withRates) {
    const [lo, hi] = wilson(k, n);
    console.log(
      `${name.padEnd(25)} ${`${k}/${n}`.padStart(6)}  ${`${pct(lo)}-${pct(hi)}`.padEnd(10)}  ${pct((k / n) ** n)}`,
    );
  }
  const { mean, se } = meanSe([...withRates.values()].map(({ k, n }) => k / n));
  console.log(
    `\nsuite: ${pct(mean)} of trials pass, clustered SE ${pct(se)}, 95% CI ${pct(Math.max(0, mean - Z * se))}-${pct(Math.min(1, mean + Z * se))}`,
  );

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
