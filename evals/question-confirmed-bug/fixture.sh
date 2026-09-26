#!/usr/bin/env bash
# Workspace: daysBetween() divides by an hour instead of a day.
set -euo pipefail
cat > dates.mjs <<'SRC'
const HOUR = 60 * 60 * 1000;

export function daysBetween(a, b) {
  return Math.round((b - a) / HOUR);
}
SRC
cat > dates.test.mjs <<'SRC'
import assert from "node:assert/strict";
import { test } from "node:test";
import { daysBetween } from "./dates.mjs";

test("one week apart", () => {
  assert.equal(daysBetween(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 8)), 7);
});
SRC
