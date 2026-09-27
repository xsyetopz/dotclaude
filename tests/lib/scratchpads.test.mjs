// Which Claude Code scratchpads and temp entries count as idle for pruning.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { staleEntries, tempRoot } from "../../hooks/lib/_scratchpads.mjs";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

/** Create `rel` under `root` (a folder when it ends in "/"), aged `days`. */
function make(root, rel, days) {
  const file = path.join(root, rel);
  if (rel.endsWith("/")) fs.mkdirSync(file, { recursive: true });
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");
  }
  const at = new Date(now - days * DAY);
  fs.utimesSync(file, at, at);
}

/** Age every folder on the way down, so only the files decide. */
function ageFolders(dir, days) {
  const at = new Date(now - days * DAY);
  for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory()) ageFolders(path.join(dir, e.name), days);
  fs.utimesSync(dir, at, at);
}

test("idle sessions and loose entries are stale; recent ones and the current session stay", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-scratch-"));
  make(root, "-proj/old-session/scratchpad/build.log", 5);
  make(root, "-proj/busy-session/scratchpad/work/file.o", 5);
  make(root, "-proj/busy-session/tasks/a.output", 0);
  make(root, "-proj/current/scratchpad/big.bin", 9);
  make(root, "loose-build/out.o", 4);
  make(root, "fresh-build/out.o", 0);
  ageFolders(root, 30);
  // A file touched today inside busy-session keeps the whole session.
  make(root, "-proj/busy-session/tasks/a.output", 0);
  make(root, "fresh-build/out.o", 0);
  const stale = staleEntries(root, 3, new Set(["current"]), now)
    .map((p) => path.relative(root, p))
    .sort();
  expect(stale).toStrictEqual(["-proj/old-session", "loose-build"]);
});

test("the temp root follows CLAUDE_CODE_TMPDIR, else /tmp", () => {
  const uid = process.getuid?.() ?? 0;
  expect(tempRoot({})).toBe(`/tmp/claude-${uid}`);
  expect(tempRoot({ CLAUDE_CODE_TMPDIR: "/scratch" })).toBe(
    `/scratch/claude-${uid}`,
  );
});
