#!/usr/bin/env bun
// Score a `claude plugin eval --keep-temp --json` result with each case's
// test oracle, and add each run's token split.
//
//   bun evals/oracle.mjs <result.json>
//
// `claude plugin eval` has no grader that runs a command, so the oracle runs
// after the eval. For each run of a case with an `oracle.sh`, it copies the
// kept workspace, runs `bash oracle.sh` in the copy with `ORACLE_DIR` set to
// the case directory, and adds an `oracle` grader that passes on exit 0. A case
// with a `reply.json` also gets the `word-count` and `adverbs` graders of
// `evals/reply.mjs`, which read the final reply from the trace. The
// agent never sees the oracle, so it cannot fit the code to it. The token
// split comes from the `result` event of the run's stream-json trace. The
// result file is rewritten in place. Exit 2 when a workspace was not kept.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalReply, gradeAdverbs, gradeWordCount } from "./reply.mjs";

const TIMEOUT_MS = 180_000;

/** Input, output, cache-read, and cache-write tokens of one run, or null. */
export function runTokens(traceFile) {
  let text;
  try {
    text = fs.readFileSync(traceFile, "utf8");
  } catch {
    return null;
  }
  let usage = null;
  for (const line of text.split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "result" && event.usage) usage = event.usage;
  }
  if (!usage) return null;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

/** Run the oracle in `copy`, a private copy of the workspace, and remove it. */
function runOracle(oracle, caseDir, copy) {
  try {
    const r = spawnSync("bash", [oracle], {
      cwd: copy,
      env: { ...process.env, ORACLE_DIR: caseDir },
      encoding: "utf8",
      timeout: TIMEOUT_MS,
    });
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    return {
      passed: r.status === 0,
      explanation:
        r.status === 0
          ? "oracle passed"
          : `oracle ${r.error ? r.error.message : `exit ${r.status}`}: ${output.slice(-500)}`,
    };
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

function copyOut(workspace) {
  if (!fs.existsSync(workspace)) return null;
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-oracle-"));
  fs.cpSync(workspace, copy, { recursive: true });
  return copy;
}

/**
 * Copy the kept workspace to a new temp folder, or return null when it is
 * gone. When the plugin wrote to `home/` or `tmp/`, the CLI moves them into
 * `sealed/` with mode 000. The seal opens only during the copy.
 */
function copyWorkspace(kept) {
  const plain = path.join(kept, "home", "cwd");
  if (fs.existsSync(plain)) return copyOut(plain);
  const sealed = path.join(kept, "sealed");
  let mode;
  try {
    mode = fs.statSync(sealed).mode & 0o777;
    fs.chmodSync(sealed, 0o500);
  } catch {
    return null;
  }
  try {
    return copyOut(path.join(sealed, "home", "cwd"));
  } finally {
    fs.chmodSync(sealed, mode);
  }
}

/** Put `graders` on the run in place of any of the same names. */
function setGraders(run, graders) {
  const names = new Set(graders.map((g) => g.name));
  run.graders = [
    ...(run.graders ?? []).filter((g) => !names.has(g.name)),
    ...graders,
  ];
  run.passed = run.graders.every((g) => g.scored === false || g.passed);
}

/** The reply graders of a case, from its `reply.json`, or null. */
function replyBound(caseDir) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(caseDir, "reply.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

/** Add the oracle and reply graders and tokens to each run. Returns the runs whose workspace is gone. */
export function grade(result, root) {
  const missing = [];
  for (const c of result.cases) {
    const caseDir = path.resolve(root, c.dir ?? "");
    const oracle = path.join(caseDir, "oracle.sh");
    const hasOracle = fs.existsSync(oracle);
    const bound = replyBound(caseDir);
    for (const [arm, runs] of Object.entries(c.arms ?? {}))
      for (const [i, run] of runs.entries()) {
        const kept = run.tracePath
          ? path.dirname(path.dirname(run.tracePath))
          : null;
        if (kept) run.tokens = runTokens(run.tracePath);
        const reply = bound && kept ? finalReply(run.tracePath) : null;
        if (reply !== null)
          setGraders(run, [
            gradeWordCount(reply, bound.maxWords),
            gradeAdverbs(reply),
          ]);
        if (!hasOracle) continue;
        let verdict;
        if (run.error) verdict = { passed: false, explanation: "run failed" };
        else {
          const copy = kept && copyWorkspace(kept);
          if (!copy) {
            missing.push(`${c.name} ${arm} #${i + 1}`);
            continue;
          }
          verdict = runOracle(oracle, caseDir, copy);
        }
        setGraders(run, [
          { name: "oracle", weight: 1, scored: true, ...verdict },
        ]);
      }
  }
  return missing;
}

if (import.meta.main) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error("Usage: bun evals/oracle.mjs <result.json>");
    process.exit(2);
  }
  const result = JSON.parse(fs.readFileSync(file, "utf8"));
  const missing = grade(result, path.dirname(import.meta.dirname));
  if (missing.length) {
    console.error(
      `No kept workspace for ${missing.length} runs, for example ${missing[0]}. Re-run the eval with --keep-temp. Nothing was written.`,
    );
    process.exit(2);
  }
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Scored ${file} with the case oracles.`);
}
