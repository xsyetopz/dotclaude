#!/usr/bin/env bash
# Workspace: the report average is wrong because parseCsv() drops the last row
# when the input has no trailing newline. mean() is correct.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
cat > csv.mjs <<'SRC'
export function parseCsv(text) {
  const [header, ...rows] = text.split("\n").slice(0, -1);
  const keys = header.split(",");
  return rows.map((row) =>
    Object.fromEntries(row.split(",").map((value, i) => [keys[i], value])),
  );
}
SRC
cat > stats.mjs <<'SRC'
export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
SRC
cat > report.mjs <<'SRC'
import { parseCsv } from "./csv.mjs";
import { mean } from "./stats.mjs";

export function averageScore(text) {
  return mean(parseCsv(text).map((row) => Number(row.score)));
}
SRC
cat > report.test.mjs <<'SRC'
import assert from "node:assert/strict";
import { test } from "node:test";
import { averageScore } from "./report.mjs";

test("average score", () => {
  assert.equal(averageScore("name,score\nana,4\nbo,8\ncy,9"), 7);
});
SRC
git add -A
git commit -qm init
