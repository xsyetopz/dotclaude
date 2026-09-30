// Open-task check: a turn that ends with tasks still pending or in progress
// is sent back when an open task was not reported before.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openTasks, taskListDir } from "../../hooks/lib/_tasks.mjs";
import { blocked, feedback, hook, session } from "../support/hooks.mjs";

const config = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-tasks-"));
const tasks = (list, entries) => {
  const dir = path.join(config, "tasks", list);
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, status] of entries)
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify({ id, subject: `Task ${id}`, status }),
    );
};
const stop = (sid, extra = {}, env = {}) =>
  hook(
    "stop/check-open-tasks.mjs",
    { session_id: sid, hook_event_name: "Stop", ...extra },
    { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_TASK_LIST_ID: "", ...env },
  );

test("the task list directory follows the list ID and the session", () => {
  expect(taskListDir("s1", { CLAUDE_CONFIG_DIR: "/c" })).toBe("/c/tasks/s1");
  expect(
    taskListDir("s1", {
      CLAUDE_CONFIG_DIR: "/c",
      CLAUDE_CODE_TASK_LIST_ID: "team a/b",
    }),
  ).toBe("/c/tasks/team-a-b");
});

test("open tasks are pending or in progress, in ID order", () => {
  tasks("order", [
    ["10", "pending"],
    ["2", "in_progress"],
    ["3", "completed"],
  ]);
  fs.writeFileSync(path.join(config, "tasks", "order", "4.json"), "{");
  expect(
    openTasks(path.join(config, "tasks", "order")).map((t) => t.id),
  ).toEqual(["2", "10"]);
  expect(openTasks(path.join(config, "tasks", "missing"))).toEqual([]);
});

test("a stop blocks only when an open task was not reported before", () => {
  const sid = session();
  tasks(sid, [
    ["1", "completed"],
    ["2", "in_progress"],
  ]);
  const first = stop(sid);
  expect(blocked(first)).toBe("Stop");
  expect(feedback(first)).toContain("#2 Task 2");
  expect(feedback(first)).not.toContain("#1");
  expect(stop(sid), "the same open set lets the stop through").toBeNull();
  tasks(sid, [["3", "pending"]]);
  expect(blocked(stop(sid)), "a new open task blocks again").toBe("Stop");
  tasks(sid, [["3", "completed"]]);
  expect(stop(sid), "a task already reported stays open").toBeNull();
  tasks(sid, [["4", "pending"]]);
  const again = stop(sid);
  expect(blocked(again), "a new task blocks again").toBe("Stop");
  expect(feedback(again)).toContain("#2 Task 2");
  tasks(sid, [
    ["2", "completed"],
    ["4", "completed"],
  ]);
  expect(stop(sid)).toBeNull();
});

test("no block for a continuation, background work, or the option off", () => {
  const sid = session();
  tasks(sid, [["1", "pending"]]);
  expect(stop(sid, { stop_hook_active: true })).toBeNull();
  expect(
    stop(sid, { background_tasks: [{ type: "subagent", id: "a1" }] }),
  ).toBeNull();
  expect(
    stop(sid, {}, { CLAUDE_PLUGIN_OPTION_TASK_CHECK: "false" }),
  ).toBeNull();
  expect(stop(session()), "a session without tasks").toBeNull();
});

test("no block for a subagent or a turn that waits for the user", () => {
  const sid = session();
  tasks(sid, [["1", "pending"]]);
  expect(stop(sid, { agent_id: "a1" })).toBeNull();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-wait-"));
  const transcript = path.join(dir, "t.jsonl");
  for (const name of ["AskUserQuestion", "ExitPlanMode"]) {
    fs.writeFileSync(
      transcript,
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name, input: {} }],
        },
      }),
    );
    expect(stop(sid, { transcript_path: transcript }), name).toBeNull();
  }
  expect(blocked(stop(sid)), "the gate still applies").toBe("Stop");
  fs.rmSync(dir, { recursive: true });
});

test("CLAUDE_CODE_TASK_LIST_ID selects a shared list", () => {
  tasks("shared", [["1", "in_progress"]]);
  expect(
    blocked(stop(session(), {}, { CLAUDE_CODE_TASK_LIST_ID: "shared" })),
  ).toBe("Stop");
});
