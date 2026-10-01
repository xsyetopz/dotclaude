#!/usr/bin/env bash
# The loop files are valid, and no source changed before the user approved.
set -euo pipefail
git diff --quiet HEAD -- src test
node --input-type=module <<'JS'
import fs from "node:fs";
const fail = (why) => { console.error(why); process.exit(1); };
const loop = JSON.parse(fs.readFileSync(".dotclaude/loop/loop.json", "utf8"));
if (!/node\s+--test/.test(loop.oracle ?? "")) fail(`oracle: ${loop.oracle}`);
if (!(loop.protected ?? []).some((glob) => glob.startsWith("test")))
  fail(`protected does not cover test/: ${loop.protected}`);
const slices = fs
  .readFileSync(".dotclaude/loop/slices.jsonl", "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));
if (slices.length < 2) fail(`only ${slices.length} slices`);
const ids = new Set(slices.map((s) => s.id));
for (const s of slices) {
  for (const key of ["id", "title", "files", "deps", "risk", "status"])
    if (!(key in s)) fail(`slice ${s.id} has no ${key}`);
  if (s.status !== "pending") fail(`slice ${s.id} is ${s.status}`);
  if (s.files.length > 5) fail(`slice ${s.id} has ${s.files.length} files`);
  for (const dep of s.deps) if (!ids.has(dep)) fail(`slice ${s.id}: unknown dep ${dep}`);
}
// The slice that deletes fmt.mjs depends on the slices that remove its callers.
const remover = slices.find((s) => s.files.some((f) => f.includes("legacy/fmt")));
if (!remover) fail("no slice deletes src/legacy/fmt.mjs");
if (remover.deps.length === 0) fail(`slice ${remover.id} deletes fmt.mjs with no deps`);
JS
