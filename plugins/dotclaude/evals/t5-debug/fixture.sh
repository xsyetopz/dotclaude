#!/usr/bin/env bash
# Workspace: `loadConfig()` merges overrides into the shared `DEFAULTS`
# object, so one client's settings leak into the next. A shallow copy fixes
# `retries` but still shares the nested `headers` object, which
# `setHeader()` mutates. `retry.mjs` is correct: `retries` counts the extra
# attempts after the first.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
cat > config.mjs <<'SRC'
export const DEFAULTS = {
  retries: 3,
  timeoutMs: 5000,
  headers: { accept: "application/json" },
};

export function loadConfig(overrides = {}) {
  return Object.assign(DEFAULTS, overrides);
}
SRC
cat > retry.mjs <<'SRC'
// Call `fn` once, then up to `retries` more times while it throws.
export async function withRetry(fn, retries) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt === retries) throw error;
    }
  }
}
SRC
cat > client.mjs <<'SRC'
import { loadConfig } from "./config.mjs";
import { withRetry } from "./retry.mjs";

export function makeClient(overrides) {
  const config = loadConfig(overrides);
  return {
    config,
    setHeader(name, value) {
      config.headers[name] = value;
    },
    call(fn) {
      return withRetry(() => fn(config), config.retries);
    },
  };
}
SRC
cat > client.test.mjs <<'SRC'
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeClient } from "./client.mjs";

test("a client can turn retries off", async () => {
  const client = makeClient({ retries: 0 });
  let calls = 0;
  await assert.rejects(
    client.call(() => {
      calls++;
      throw new Error("down");
    }),
  );
  assert.equal(calls, 1);
});

test("a default client retries 3 times", async () => {
  const client = makeClient();
  let calls = 0;
  await assert.rejects(
    client.call(() => {
      calls++;
      throw new Error("down");
    }),
  );
  assert.equal(calls, 4);
});
SRC
git add -A
git commit -qm init
