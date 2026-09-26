#!/usr/bin/env bash
# Workspace: slugify() keeps uppercase (the requested fix); truncate() has an
# unrelated off-by-one that no test covers.
set -euo pipefail
cat > text.mjs <<'SRC'
export function slugify(s) {
  return s.trim().replace(/\s+/g, "-");
}

export function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n + 1)}…` : s;
}
SRC
cat > text.test.mjs <<'SRC'
import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "./text.mjs";

test("slugify lowercases", () => {
  assert.equal(slugify(" Hello World "), "hello-world");
});
SRC
