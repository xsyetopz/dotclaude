// Bash guard decisions for git commands that overwrite the worktree. They ask
// only when the paths they overwrite hold uncommitted changes.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hook } from "../support/hooks.mjs";

function repo(name) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `dotclaude-${name}-`)),
  );
  const run = (...args) => execFileSync("git", ["-C", dir, ...args]);
  run("init", "-q", "-b", "main");
  run("config", "user.email", "t@example.com");
  run("config", "user.name", "t");
  for (const round of [1, 2]) {
    fs.writeFileSync(path.join(dir, "a.js"), `${round}\n`);
    fs.writeFileSync(path.join(dir, "b.js"), `${round}\n`);
    run("add", ".");
    run("commit", "-qm", `c${round}`);
  }
  return dir;
}

// `dirty` has an uncommitted change in `a.js` only. `clean` has none.
const dirty = repo("dirty");
fs.writeFileSync(path.join(dirty, "a.js"), "work\n");
const clean = repo("clean");
// `collide` deleted `c.js` in its last commit and has an untracked `c.js`.
const collide = repo("collide");
fs.writeFileSync(path.join(collide, "c.js"), "old\n");
execFileSync("git", ["-C", collide, "add", "c.js"]);
execFileSync("git", ["-C", collide, "commit", "-qm", "c3"]);
execFileSync("git", ["-C", collide, "rm", "-q", "c.js"]);
execFileSync("git", ["-C", collide, "commit", "-qm", "c4"]);
fs.writeFileSync(path.join(collide, "c.js"), "untracked work\n");

// A native path as a command writes it. Git Bash on Windows reads `\` as an
// escape and takes `C:/` paths.
const sh = (p) => p.split(path.sep).join("/");

const decision = (command) =>
  hook(
    "pre-tool-use/block-destructive-commands.mjs",
    {
      cwd: dirty,
      tool_name: "Bash",
      permission_mode: "default",
      tool_input: { command },
    },
    { CLAUDE_PROJECT_DIR: dirty },
  )?.hookSpecificOutput.permissionDecision ?? null;

test.each([
  ["git checkout -- b.js"],
  ["git checkout HEAD~1 -- b.js"],
  ["git restore b.js"],
  ["git restore --source HEAD~1 b.js"],
  [`cd ${sh(clean)} && git reset -q --hard HEAD~1`],
  [`git -C ${sh(clean)} reset --hard`],
  [`git -C ${sh(clean)} checkout .`],
  [`git -C ${sh(collide)} reset --hard HEAD`],
  [`git -C ${sh(collide)} reset --hard HEAD~3`],
])("a discard of clean paths runs: %s", (command) => {
  expect(decision(command)).toBe(null);
});

test.each([
  ["git checkout -- a.js", "a changed file"],
  ["git checkout .", "a worktree with a change"],
  ["git restore .", "a worktree with a change"],
  ["git restore --source HEAD~1 a.js", "a changed file"],
  ["git reset --hard", "a worktree with a change"],
  ["git checkout -f main", "a worktree with a change"],
  ["git checkout -- $F", "a path only known at run time"],
  ["cd $W && git reset --hard", "a folder only known at run time"],
  [
    `git -C ${sh(clean)} stash pop && git -C ${sh(clean)} reset --hard`,
    "changes that an earlier command restores",
  ],
  [
    `cd ${sh(clean)} && patch -p1 < x.diff && git checkout .`,
    "a patch before it",
  ],
  [
    `git -C ${sh(collide)} reset --hard HEAD~1`,
    "an untracked file the commit has",
  ],
  [
    `git -C ${sh(collide)} reset --hard $REV`,
    "a commit only known at run time",
  ],
])("a discard that can lose work asks: %s (%s)", (command) => {
  expect(decision(command)).toBe("ask");
});
