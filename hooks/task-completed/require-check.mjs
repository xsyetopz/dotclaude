#!/usr/bin/env bun
// TaskCompleted hook: send Claude back once when it marks a task completed
// after code edits with no later check run. It reads the same ledger as the
// stop gate. Exit code 2 keeps the task open and gives stderr to Claude.

import { exitBlocking, option, run, TAG } from "../lib/_common.mjs";
import { load, save } from "../lib/_ledger.mjs";

run((data) => {
  if (!option("gate_verify")) return;
  if (!data.session_id) return;
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
  // Input fields, as logged from Claude Code 2.1.28x: `task_id`,
  // `task_subject`, `task_description`.
  const task = [
    data.task_id ? ` #${data.task_id}` : "",
    data.task_subject ? ` "${data.task_subject}"` : "",
  ].join("");
  exitBlocking(
    `${TAG} Code changed after the last check run (last edit: \`${lastEdit.path}\`), so the task${task} is not verified. Run the tests, build, or lint that cover this change. Then mark the task completed. If no check can run, mark the task completed again, and say in your reply that the change is unverified.`,
  );
});
