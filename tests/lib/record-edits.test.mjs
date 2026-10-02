// The edit recorder resolves a relative `file_path` from the hook's folder.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";
import { load } from "../../hooks/lib/_ledger.mjs";
import record from "../../hooks/post-tool-use/record-edits-and-checks.mjs";

function setup() {
  const project = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-edits-")),
  );
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-data-"));
  const io = {
    ...nodeIo(),
    env: { CLAUDE_PLUGIN_DATA: data },
    cwd: project,
  };
  return { project, io };
}

const edit = (file_path, extra = {}) => ({
  session_id: "s1",
  hook_event_name: "PostToolUse",
  tool_name: "Edit",
  tool_input: { file_path },
  ...extra,
});

test("a relative file_path is recorded below the project folder", async () => {
  const { project, io } = setup();
  await record(io, edit("src/a.js"));
  expect((await load(io, "s1")).edited).toEqual(["src/a.js"]);
  await record(io, edit(path.join(project, "src", "b.js")));
  expect((await load(io, "s1")).edited).toEqual(["src/a.js", "src/b.js"]);
});

test("an empty or outside file_path records nothing", async () => {
  const { io } = setup();
  await record(io, edit(""));
  await record(io, edit("../outside.js"));
  expect((await load(io, "s1")).edited).toBeUndefined();
});

test("a relative Bash cwd is resolved from the hook's folder", async () => {
  const { project, io } = setup();
  fs.mkdirSync(path.join(project, "sub"));
  fs.writeFileSync(path.join(project, "sub", "f.txt"), "x");
  await record(io, {
    session_id: "s1",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    cwd: "sub",
    tool_input: { command: "cat f.txt" },
  });
  expect(Object.keys((await load(io, "s1")).reads)).toEqual([
    path.join(project, "sub", "f.txt"),
  ]);
});

test("two edits recorded at the same time both stay", async () => {
  const { io } = setup();
  await Promise.all([
    record(io, edit("src/a.js")),
    record(io, edit("src/b.js")),
  ]);
  expect([...(await load(io, "s1")).edited].sort()).toEqual([
    "src/a.js",
    "src/b.js",
  ]);
});
