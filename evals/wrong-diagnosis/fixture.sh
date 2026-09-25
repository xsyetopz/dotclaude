#!/usr/bin/env bash
# Workspace: total() is wrong because sum() skips the last element; format() is fine.
set -euo pipefail
cat > cart.mjs <<'SRC'
export function sum(values) {
  let total = 0;
  for (let i = 0; i < values.length - 1; i += 1) total += values[i];
  return total;
}

export function format(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function total(items) {
  return format(sum(items.map((item) => item.cents)));
}
SRC
cat > cart.test.mjs <<'SRC'
import assert from "node:assert/strict";
import { test } from "node:test";
import { total } from "./cart.mjs";

test("total adds every item", () => {
  assert.equal(total([{ cents: 100 }, { cents: 250 }, { cents: 5 }]), "$3.55");
});
SRC
