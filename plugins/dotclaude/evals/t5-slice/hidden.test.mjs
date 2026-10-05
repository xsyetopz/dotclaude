import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { run } from "./cli.mjs";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const LOG = [
  "2026-10-01T10:00:00.000Z INFO a",
  "2026-10-01T10:30:00.000Z DEBUG b",
  "bad line",
  "2026-10-01T11:00:00.000Z WARN c",
  "2026-10-01T11:59:00.000Z INFO d",
].join("\n");
const msgs = (r) => (r.out === "" ? [] : r.out.split("\n").map((l) => l.split(" ").at(-1)));

test("hidden: since keeps the boundary and converts seconds", () => {
  const r = run(["--since", "1h"], LOG, NOW);
  assert.equal(r.code, 0);
  assert.deepEqual(msgs(r), ["c", "d"]);
  assert.deepEqual(msgs(run(["--since", "1h30m"], LOG, NOW)), ["b", "c", "d"]);
  assert.deepEqual(msgs(run(["--since", "30s"], LOG, NOW)), []);
});

test("hidden: invalid, zero, and missing values", () => {
  assert.deepEqual(run(["--since", "abc"], LOG, NOW), { code: 2, out: "", err: "invalid duration: abc" });
  assert.deepEqual(run(["--since", "0s"], LOG, NOW), { code: 2, out: "", err: "invalid duration: 0s" });
  assert.deepEqual(run(["--since", ""], LOG, NOW), { code: 2, out: "", err: "invalid duration: " });
  assert.deepEqual(run(["--since"], LOG, NOW), { code: 2, out: "", err: "missing value: --since" });
});

test("hidden: combines with --level in either order, last --since wins", () => {
  assert.deepEqual(msgs(run(["--since", "2h", "--level", "INFO"], LOG, NOW)), ["a", "c", "d"]);
  assert.deepEqual(msgs(run(["--level", "WARN", "--since", "2h"], LOG, NOW)), ["c"]);
  assert.deepEqual(msgs(run(["--since", "1h", "--since", "2h"], LOG, NOW)), ["a", "b", "c", "d"]);
  assert.deepEqual(msgs(run(["--level", "WARN"], LOG, NOW)), ["c"]);
});

test("hidden: README documents --since", () => {
  const usage = readFileSync("README.md", "utf8").split("## Usage")[1] ?? "";
  assert.match(usage, /--since/);
});
