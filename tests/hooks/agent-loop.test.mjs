// Agent loop: subagents cannot change the oracle files that `loop.json`
// protects, a slice implemented without a review blocks the stop once, and
// the status line shows the merged slices.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters as plain } from "node:util";
import { loopProgress, mainRoot } from "../../hooks/lib/_loop.mjs";
import { renderMain } from "../../hooks/lib/_status-line.mjs";
import { blocked, feedback, hook, session, tmp } from "../support/hooks.mjs";

const root = fs.realpathSync(tmp("dotclaude-loop-"));
execFileSync("git", ["init", "-q", root]);
const worktree = path.join(root, ".claude", "worktrees", "agent-a1");
for (const dir of [root, worktree]) {
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tests", "a.test.mjs"), "test('a')\n");
  fs.writeFileSync(path.join(dir, "src", "a.mjs"), "export {}\n");
}
const loopDir = path.join(root, ".dotclaude", "loop");
fs.mkdirSync(loopDir, { recursive: true });
fs.writeFileSync(
  path.join(loopDir, "loop.json"),
  JSON.stringify({ oracle: "bun test", protected: ["tests/**"] }),
);
const slices = (...list) =>
  fs.writeFileSync(
    path.join(loopDir, "slices.jsonl"),
    `${list.map((s) => JSON.stringify(s)).join("\n")}\nnot json\n`,
  );

const decision = (script, toolName, toolInput, extra = {}, cwd = root) =>
  hook(
    script,
    {
      session_id: session(),
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: toolInput,
      cwd,
      ...extra,
    },
    { CLAUDE_PROJECT_DIR: cwd },
  )?.hookSpecificOutput?.permissionDecision ?? null;

const editAs = (extra, file, cwd = root) =>
  decision(
    "pre-tool-use/confirm-risky-edits.mjs",
    "Edit",
    { file_path: path.join(cwd, file), old_string: "a", new_string: "b" },
    extra,
    cwd,
  );
const bashAs = (extra, command, cwd = root) =>
  decision(
    "pre-tool-use/block-destructive-commands.mjs",
    "Bash",
    { command },
    extra,
    cwd,
  );
const agent = { agent_id: "a1", agent_type: "dotclaude:implementer" };

test("a worktree path maps to the main project root", () => {
  expect(mainRoot(worktree)).toBe(root);
  expect(mainRoot(path.join(worktree, "src"))).toBe(root);
  expect(mainRoot(root)).toBe(root);
});

test("a subagent cannot edit a protected oracle file", () => {
  expect(editAs(agent, "tests/a.test.mjs")).toBe("deny");
  expect(editAs(agent, "src/a.mjs")).toBeNull();
});

test("the main conversation can edit the oracle", () => {
  expect(editAs({}, "tests/a.test.mjs")).toBeNull();
});

test("the oracle is protected in an agent worktree too", () => {
  expect(editAs(agent, "tests/a.test.mjs", worktree)).toBe("deny");
  expect(editAs(agent, "src/a.mjs", worktree)).toBeNull();
});

test("a subagent cannot change or remove the oracle from Bash", () => {
  expect(bashAs(agent, "sed -i '' 's/a/b/' tests/a.test.mjs")).toBe("deny");
  expect(bashAs(agent, "rm tests/a.test.mjs")).toBe("deny");
  expect(bashAs(agent, "git rm -q tests/a.test.mjs", worktree)).toBe("deny");
  expect(bashAs(agent, "mv tests/a.test.mjs /tmp/x")).toBe("deny");
  expect(bashAs(agent, "rm src/a.mjs")).not.toBe("deny");
  expect(bashAs({}, "rm tests/a.test.mjs")).not.toBe("deny");
});

test("a subagent cannot remove a directory that holds the oracle", () => {
  expect(bashAs(agent, "rm -rf tests")).toBe("deny");
  expect(bashAs(agent, "rm -rf tests", worktree)).toBe("deny");
  expect(bashAs(agent, "git -C . rm -r tests")).toBe("deny");
  expect(bashAs(agent, "git -C tests rm a.test.mjs")).toBe("deny");
  expect(bashAs(agent, "rm -rf src")).not.toBe("deny");
});

const stop = (sid, extra = {}) =>
  hook(
    "stop/check-loop-reviews.mjs",
    {
      session_id: sid,
      hook_event_name: "Stop",
      cwd: root,
      ...extra,
    },
    { CLAUDE_PROJECT_DIR: root },
  );

test("an implemented slice without a review blocks the stop once", () => {
  slices(
    { id: "parse", status: "merged" },
    { id: "emit", status: "implemented" },
  );
  const sid = session();
  const first = stop(sid);
  expect(blocked(first)).toBe("Stop");
  expect(feedback(first)).toContain("`emit`");
  expect(feedback(first)).not.toContain("`parse`");
  expect(stop(sid)).toBeNull();
  expect(stop(session(), agent)).toBeNull();
});

test("reviewed and failed slices let the stop through", () => {
  slices({ id: "parse", status: "reviewed" }, { id: "emit", status: "failed" });
  expect(stop(session())).toBeNull();
});

test("the status line shows merged slices of all slices", () => {
  slices(
    { id: "a", status: "merged" },
    { id: "b", status: "implemented" },
    { id: "c", status: "pending" },
  );
  const loop = loopProgress(worktree);
  expect(loop).toEqual({ done: 1, total: 3 });
  const line = plain(renderMain({ cwd: root }, { columns: 200, loop }));
  expect(line).toContain("loop 1/3");
  expect(loopProgress(tmp("dotclaude-noloop-"))).toBeNull();
});
