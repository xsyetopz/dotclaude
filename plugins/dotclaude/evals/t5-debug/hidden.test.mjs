import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, loadConfig } from "./config.mjs";
import { makeClient } from "./client.mjs";

test("hidden: clients do not share settings or headers", () => {
  const a = makeClient({ retries: 0, timeoutMs: 10 });
  a.setHeader("authorization", "Bearer a");
  const b = makeClient();
  assert.equal(b.config.retries, 3);
  assert.equal(b.config.timeoutMs, 5000);
  assert.deepEqual(b.config.headers, { accept: "application/json" });
  assert.equal(a.config.headers.authorization, "Bearer a");
  assert.deepEqual(DEFAULTS, {
    retries: 3,
    timeoutMs: 5000,
    headers: { accept: "application/json" },
  });
});

test("hidden: overrides still apply", () => {
  const c = loadConfig({ retries: 1, headers: { accept: "text/plain" } });
  assert.equal(c.retries, 1);
  assert.equal(c.headers.accept, "text/plain");
  assert.equal(c.timeoutMs, 5000);
});
