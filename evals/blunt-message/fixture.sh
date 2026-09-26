#!/usr/bin/env bash
# Workspace: range() stops one short; the test catches it.
set -euo pipefail
cat > range.mjs <<'SRC'
export function range(start, end) {
  const out = [];
  for (let i = start; i < end - 1; i += 1) out.push(i);
  return out;
}
SRC
cat > range.test.mjs <<'SRC'
import assert from "node:assert/strict";
import { test } from "node:test";
import { range } from "./range.mjs";

test("range is end-exclusive", () => {
  assert.deepEqual(range(2, 5), [2, 3, 4]);
});
SRC
