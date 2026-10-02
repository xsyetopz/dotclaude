#!/usr/bin/env bash
# Workspace: a log filter CLI. `parseDuration()` returns seconds and NaN for
# bad input, so `--since` must convert to milliseconds.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
cat > duration.mjs <<'SRC'
// "1h30m" -> 5400. Units: h, m, s. NaN when the text is not a duration.
export function parseDuration(text) {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text ?? "");
  if (!match || text === "") return Number.NaN;
  const [, h = 0, m = 0, s = 0] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}
SRC
cat > logs.mjs <<'SRC'
const LINE = /^(\S+) (DEBUG|INFO|WARN|ERROR) (.*)$/;

// "2026-10-01T12:00:00Z INFO started" -> { time, level, msg }, or null.
export function parseLine(line) {
  const match = LINE.exec(line);
  if (!match) return null;
  const time = Date.parse(match[1]);
  if (Number.isNaN(time)) return null;
  return { time, level: match[2], msg: match[3] };
}
SRC
cat > filter.mjs <<'SRC'
const RANK = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

export function isLevel(level) {
  return level in RANK;
}

// Keep entries at `level` or above.
export function filterEntries(entries, { level }) {
  if (!level) return entries;
  return entries.filter((entry) => RANK[entry.level] >= RANK[level]);
}
SRC
cat > cli.mjs <<'SRC'
import { filterEntries, isLevel } from "./filter.mjs";
import { parseLine } from "./logs.mjs";

export function run(argv, text, now = Date.now()) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--level") {
      const value = argv[++i];
      if (value === undefined) return fail(`missing value: ${arg}`);
      if (!isLevel(value)) return fail(`unknown level: ${value}`);
      options.level = value;
    } else {
      return fail(`unknown option: ${arg}`);
    }
  }
  const entries = text.split("\n").map(parseLine).filter(Boolean);
  const kept = filterEntries(entries, options);
  return {
    code: 0,
    out: kept.map((e) => `${new Date(e.time).toISOString()} ${e.level} ${e.msg}`).join("\n"),
    err: "",
  };
}

function fail(err) {
  return { code: 2, out: "", err };
}
SRC
cat > cli.test.mjs <<'SRC'
import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./cli.mjs";

const LOG = [
  "2026-10-01T10:00:00.000Z INFO started",
  "not a log line",
  "2026-10-01T11:00:00.000Z WARN slow",
  "2026-10-01T12:00:00.000Z ERROR down",
].join("\n");

test("--level keeps entries at or above the level", () => {
  const r = run(["--level", "WARN"], LOG);
  assert.equal(r.code, 0);
  assert.equal(r.out.split("\n").length, 2);
});

test("an unknown option fails", () => {
  assert.deepEqual(run(["--nope"], LOG), { code: 2, out: "", err: "unknown option: --nope" });
});
SRC
cat > README.md <<'SRC'
# logfilter

Filter log lines by level.

## Usage

    run(["--level", "WARN"], text)

- `--level <DEBUG|INFO|WARN|ERROR>`: keep entries at this level or above.
SRC
git add -A
git commit -qm init
