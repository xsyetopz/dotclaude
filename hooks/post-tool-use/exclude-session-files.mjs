#!/usr/bin/env bun
// PostToolUse: when an agent creates a file that describes one session or
// one user, add it to `.git/info/exclude`, so it stays out of commits without
// a change to the project's tracked `.gitignore`. Prints nothing.
//
// Only paths whose own docs say "do not commit" are here. OpenSpec
// (`openspec/`) and Spec Kit (`.specify/`) tell users to commit their files,
// so they are not.

import fs from "node:fs";
import path from "node:path";
import { git } from "../lib/_bash-args.mjs";
import { option, projectRoot, run } from "../lib/_common.mjs";

// [test on the repo-relative path, entry for the exclude file]
const SESSION_FILES = [
  // dotclaude: the notes of the `handoff` skill.
  [(rel) => rel.startsWith(".claude/handoffs/"), () => "/.claude/handoffs/"],
  // dotclaude: `slices` skill state.
  [(rel) => rel.startsWith(".dotclaude/"), () => "/.dotclaude/"],
  // Claude Code docs: personal memory and settings, and `--worktree` checkouts.
  [(rel) => path.basename(rel) === "CLAUDE.local.md", (rel) => `/${rel}`],
  [
    (rel) => rel === ".claude/settings.local.json",
    () => "/.claude/settings.local.json",
  ],
  [
    (rel) =>
      rel === ".claude/worktrees" || rel.startsWith(".claude/worktrees/"),
    () => "/.claude/worktrees/",
  ],
];

/** The exclude entry for `abs`, with the repo root, or undefined. */
function entryFor(abs) {
  let dir = abs;
  let base = "";
  try {
    if (!fs.statSync(abs).isDirectory()) {
      dir = path.dirname(abs);
      base = path.basename(abs);
    }
  } catch {
    return undefined;
  }
  // git gives the folder's path below the top level, with `/`. A path
  // comparison with the top level fails where the two name one folder
  // differently: `/private/var` on macOS, `RUNNER~1` short names on Windows.
  const out = git(dir, ["rev-parse", "--show-toplevel", "--show-prefix"]);
  const [top, prefix] = (out ?? "").split("\n");
  if (!top) return undefined;
  const rel = `${prefix}${base}`.replace(/\/$/, "");
  if (!rel) return undefined;
  const hit = SESSION_FILES.find(([test]) => test(rel));
  return hit && { top, rel, entry: hit[1](rel) };
}

function exclude(abs) {
  const found = entryFor(abs);
  if (!found) return;
  const { top, rel, entry } = found;
  // `check-ignore -q` exits 0 (empty output) only for an ignored path.
  if (git(top, ["check-ignore", "-q", "--", rel]) !== undefined) return;
  const file = git(top, ["rev-parse", "--git-path", "info/exclude"])?.trim();
  if (!file) return;
  const target = path.resolve(top, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const old = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (old.split("\n").includes(entry)) return;
  const sep = old === "" || old.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(target, `${sep}${entry}\n`);
}

run((data) => {
  if (!option("context_session_files")) return;
  const input = data.tool_input ?? {};
  if (data.tool_name === "EnterWorktree") {
    const dir = path.join(projectRoot(data), ".claude", "worktrees");
    if (fs.existsSync(dir)) exclude(dir);
    return;
  }
  const file = input.file_path || input.notebook_path;
  if (typeof file === "string" && file) exclude(path.resolve(file));
});
