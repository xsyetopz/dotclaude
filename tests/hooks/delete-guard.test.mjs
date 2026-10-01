// Bash guard decisions for bulk deletes in temp folders and gitignored paths.
// The test project lives under the system temp folder, as many worktrees do,
// so these tests also show that project files keep the project rules there.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hook } from "../support/hooks.mjs";

const project = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-delete-")),
);
const scratchpad = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-cc-"));
execFileSync("git", ["init", "-q", project]);
fs.writeFileSync(
  path.join(project, ".gitignore"),
  "dist/\nnode_modules/\nbuild/\n",
);
fs.mkdirSync(path.join(project, "src"));
fs.writeFileSync(path.join(project, "src/a.js"), "1\n");
fs.mkdirSync(path.join(project, "build/keep"), { recursive: true });
fs.writeFileSync(path.join(project, "build/keep/a.txt"), "1\n");
execFileSync("git", ["-C", project, "add", "."]);
execFileSync("git", ["-C", project, "add", "-f", "build/keep/a.txt"]);
fs.mkdirSync(path.join(project, "notes"));
fs.writeFileSync(path.join(project, "notes/n.md"), "1\n");

const decision = (command) =>
  hook(
    "pre-tool-use/block-destructive-commands.mjs",
    {
      cwd: project,
      tool_name: "Bash",
      permission_mode: "default",
      tool_input: { command },
    },
    { CLAUDE_PROJECT_DIR: project, CLAUDE_CODE_TMPDIR: scratchpad },
  )?.hookSpecificOutput.permissionDecision ?? null;

test.each([
  ['S="$TMPDIR/mdlcheck" && rm -rf "$S"'],
  ['rm -r "$CLAUDE_CODE_TMPDIR/x"'],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
  ['rm -rf "${CLAUDE_CODE_TMPDIR}"/claude-501/y'],
  ["cd /tmp && rm -rf oc-shots/$n"],
  ["find /tmp -maxdepth 1 -name 'ojd-*' -exec rm -rf {} +"],
  ["find dist -type f -delete"],
  ["fd -e log . dist -x rm"],
  ["fd -t d x node_modules -x rm -rf {}"],
])("a delete inside a temp entry or a gitignored path runs: %s", (command) => {
  expect(decision(command)).toBe(null);
});

test.each([
  ["rm -rf src", "tracked files in a project under a temp folder"],
  [`rm -rf ${project}/src`, "an absolute path into a project in a temp folder"],
  ["rm -rf notes", "untracked files that git does not ignore"],
  ["find src -delete", "tracked files"],
  ['find . -name "*.log" -delete', "the project root"],
  ["fd x -x rm", "the project root"],
  ["find /tmp -delete", "a whole temp folder with no name filter"],
  ['find "$TMPDIR" -name src -delete', "a temp folder that holds the project"],
  ["find dist -exec rm -rf {} /etc +", "an extra path in the delete"],
  ["fd -L x dist -x rm", "a link-following search"],
  ["find build -delete", "a tracked file in an ignored folder"],
  [
    'CLAUDE_CODE_TMPDIR=/; rm -rf "$CLAUDE_CODE_TMPDIR/etc"',
    "a reassigned temp variable",
  ],
  ["cd /tmp && rm -rf $n", "a run-time name directly in a temp folder"],
  [
    `rm -rf ${path.dirname(project)}/dotclaude-del$n`,
    "a run-time name that can complete the project's name",
  ],
  ['S="$HOME/x"; rm -rf "$S"', "a variable outside the temp folders"],
  ['S="$TMPDIR/../x"; rm -rf "$S"', "a parent segment after a temp variable"],
  ['find "$TMPDIR/"* -delete', "a glob after a temp variable"],
])("a delete that can reach user work asks: %s (%s)", (command) => {
  expect(decision(command)).toBe("ask");
});
