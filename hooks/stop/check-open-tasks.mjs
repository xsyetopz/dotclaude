#!/usr/bin/env bun
// Stop hook: send Claude back once when it ends a turn with tasks still
// pending or in progress, so the task list does not go stale when work
// finishes without a `TaskUpdate`. Each open task blocks at most once, so
// tasks left open on purpose (waiting for the user) let the stop through on
// later turns, and only a new open task blocks again. It passes for a
// subagent, and after an `AskUserQuestion` or `ExitPlanMode` call, because
// then the open tasks wait for the user's answer.

import fs from "node:fs";
import path from "node:path";
import { run, stopFeedback } from "../lib/_common.mjs";
import { option, stateDir } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { openTasks, taskListDir } from "../lib/_tasks.mjs";
import { waitsForUser } from "../lib/_transcript.mjs";

run((data) => {
  if (
    !option(process.env, "gate_tasks") ||
    data.stop_hook_active ||
    data.agent_id
  )
    return;
  // Claude is waiting for background work, which can finish a task later.
  if (
    (data.background_tasks ?? []).some(
      (t) => t.type === "shell" || t.type === "subagent",
    )
  )
    return;
  const open = openTasks(taskListDir(data.session_id));
  if (!open.length || waitsForUser(data.transcript_path)) return;
  const file = path.join(
    stateDir(nodeIo()),
    `${String(data.session_id).replace(/[^A-Za-z0-9_-]/g, "_")}.open-tasks`,
  );
  // The IDs of the open tasks that a block already listed. A task that
  // closes later does not make the tasks left open new again.
  let reported = [];
  try {
    reported = fs.readFileSync(file, "utf8").split(",");
  } catch {
    // No block yet this session.
  }
  if (open.every((t) => reported.includes(t.id))) return;
  const ids = new Set([...reported, ...open.map((t) => t.id)]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [...ids].filter(Boolean).join(","));
  const list = open.map((t) => `- #${t.id} ${t.subject}`).join("\n");
  stopFeedback(
    data,
    [
      "The task list has open tasks:",
      list,
      "The user reads the task list as the state of the work, so each status must match the work. For each open task, do one of these:",
      "- The work is done: set its status to `completed` with `TaskUpdate`.",
      "- You or the user dropped the task: set its status to `deleted` with `TaskUpdate`.",
      "- The work is not done: keep the task open, and give the reason in one line.",
      "This check does not stop you again for these tasks. Add only the task changes to your reply.",
    ].join("\n"),
  );
});
