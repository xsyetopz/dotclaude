// Session files that an agent creates go to `.git/info/exclude`.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hook } from "../support/hooks.mjs";

function freshRepo() {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-exclude-")),
  );
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

function write(dir, rel, env = {}) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x\n");
  hook(
    "post-tool-use/exclude-session-files.mjs",
    {
      cwd: dir,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: file },
    },
    { CLAUDE_PROJECT_DIR: dir, ...env },
  );
}

const excluded = (dir) =>
  fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
const untracked = (dir) =>
  execFileSync("git", ["-C", dir, "status", "--porcelain", "-uall"], {
    encoding: "utf8",
  });

test("session files are excluded once, and project files are not", () => {
  const dir = freshRepo();
  for (const rel of [
    ".claude/handoffs/2026-09-30-1200-retries.md",
    ".claude/handoffs/2026-10-01-0900-retries.md",
    ".dotclaude/loop/loop.json",
    "pkg/CLAUDE.local.md",
    ".claude/settings.local.json",
    "openspec/specs/auth/spec.md",
    "src/app.js",
  ])
    write(dir, rel);
  const lines = excluded(dir).split("\n");
  expect(lines.filter((l) => l === "/.claude/handoffs/")).toHaveLength(1);
  expect(untracked(dir).trim().split("\n").sort()).toStrictEqual([
    "?? openspec/specs/auth/spec.md",
    "?? src/app.js",
  ]);
  // `.gitignore` is the project's file, so it stays untouched.
  expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
});

test("a path the project already ignores gets no entry", () => {
  const dir = freshRepo();
  fs.writeFileSync(path.join(dir, ".gitignore"), ".claude/\n");
  const before = excluded(dir);
  write(dir, ".claude/handoffs/2026-09-30-1200-retries.md");
  expect(excluded(dir)).toBe(before);
});

test("entering a worktree excludes `.claude/worktrees/`", () => {
  const dir = freshRepo();
  fs.mkdirSync(path.join(dir, ".claude", "worktrees", "wt1"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(dir, ".claude", "worktrees", "wt1", "f"), "x");
  hook(
    "post-tool-use/exclude-session-files.mjs",
    { cwd: dir, hook_event_name: "PostToolUse", tool_name: "EnterWorktree" },
    { CLAUDE_PROJECT_DIR: dir },
  );
  expect(untracked(dir)).toBe("");
});

test("the option turns the hook off", () => {
  const dir = freshRepo();
  write(dir, ".claude/handoffs/2026-09-30-1200-retries.md", {
    CLAUDE_PLUGIN_OPTION_CONTEXT_SESSION_FILES: "false",
  });
  expect(untracked(dir)).toContain(".claude/handoffs/");
});
