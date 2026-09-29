#!/usr/bin/env bun
// TaskCompleted hook: send Claude back once when it marks a task completed
// after code edits with no later check run. It reads the same ledger as the
// stop gate. Exit code 2 keeps the task open and gives stderr to Claude.

import fs from "node:fs";
import { option, run, TAG } from "../lib/_common.mjs";
import { load, save } from "../lib/_ledger.mjs";
import { logVerdict } from "../lib/_verdicts.mjs";

run((data) => {
  if (!option("stop_gate")) return;
  // The input fields are not a stable contract yet, so each call logs them.
  logVerdict(data, "task", data.task_status ?? "", {
    fields: Object.keys(data).sort(),
  });
  if (!data.session_id) return;
  if (data.task_status && data.task_status !== "completed") return;
  const agentId = data.agent_id ?? null;
  const state = load(data.session_id, agentId);
  const { lastEdit, lastCheck } = state;
  if (
    !lastEdit ||
    (lastCheck && lastCheck.seq > lastEdit.seq) ||
    state.blockedTask === lastEdit.seq
  )
    return;
  state.blockedTask = lastEdit.seq;
  save(data.session_id, agentId, state);
  const task = data.task_name ? ` "${data.task_name}"` : "";
  fs.writeSync(
    2,
    `${TAG} Code changed after the last check run (last edit: \`${lastEdit.path}\`), so the task${task} is not verified. Run the tests, build, or lint that cover this change. Then mark the task completed. If no check can run, mark the task completed again, and say in your reply that the change is unverified.\n`,
  );
  process.exit(2);
});
