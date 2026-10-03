#!/usr/bin/env bun

// TaskCompleted hook: send Claude back once when it marks a task completed
// after code edits with no later check run that runs the code. It reads the same ledger as the
// stop gate, and it also passes when the project names no test command.
// Exit code 2 keeps the task open and gives stderr to Claude.

import { exitBlocking, run } from "../lib/_common.mjs";
import { option, TAG } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { load, save } from "../lib/_ledger.mjs";
import {
  clip,
  pendingCheck,
  staticCause,
  testAction,
} from "../lib/_verification.mjs";

run(async (data) => {
  if (!option(process.env, "gate_verify")) return;
  if (!data.session_id) return;
  const agentId = data.agent_id ?? null;
  const io = nodeIo(data);
  const state = await load(io, data.session_id, agentId);
  const { lastEdit, lastCheck } = state;
  const need = await pendingCheck(io, data, state, "blockedTask");
  if (!need) return;
  state.blockedTask = lastEdit.seq;
  await save(io, data.session_id, agentId, state);
  // Input fields, as logged from Claude Code 2.1.28x: `task_id`,
  // `task_subject`, `task_description`.
  const task = [
    data.task_id ? ` #${data.task_id}` : "",
    data.task_subject ? ` "${clip(data.task_subject, 40)}"` : "",
  ].join("");
  const why =
    need.why === "static"
      ? `${staticCause(lastCheck, `the task${task} is not verified`)}. ${testAction(need.test)}.`
      : `Code changed after the last check run (last edit: \`${lastEdit.path}\`), so the task${task} is not verified. Run the tests or build that cover this change.`;
  exitBlocking(
    `${TAG} ${why} Then mark the task completed. If no check can run, mark the task completed again, and say in your reply that the change is unverified.`,
  );
});
