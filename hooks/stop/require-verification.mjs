#!/usr/bin/env bun

// Stop and SubagentStop hook: send Claude (or a subagent) back once when it
// ends after code edits with no later check run, or when the last check
// after its edits failed.
// A check of kind `static`, such as a lint run, does not exercise the changed
// code, so after a code edit it satisfies the gate only when the project
// names no test command (see `pendingCheck`).
// A check with no kind, from an older ledger, counts as `run`.
// An edit with no check passes when the project names no test command,
// because then Claude cannot run a check, and the gate would only add a turn.
// A failed check with no edit passes, because a read-only agent such as
// `test-runner` reports failures.
// Each ledger state blocks at most once, and a continuation is never blocked again.
// The hook reads only the ledger, not the reply, because a reply can be in any language.

import { run, stopFeedback } from "../lib/_common.mjs";
import { option } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { load, save } from "../lib/_ledger.mjs";
import {
  clip,
  failedCheck,
  pendingCheck,
  staticCause,
  testAction,
} from "../lib/_verification.mjs";

run(async (data) => {
  if (!option(process.env, "gate_verify") || data.stop_hook_active) return;
  if (
    (data.background_tasks ?? []).some(
      (t) => t.type === "shell" || t.type === "subagent",
    )
  )
    return;
  // SubagentStop checks the subagent's own ledger (edits it made, checks it ran).
  const agentId =
    data.hook_event_name === "SubagentStop" ? data.agent_id : null;
  const io = nodeIo(data);
  const state = await load(io, data.session_id, agentId);
  const { lastEdit, lastCheck } = state;
  let reason;

  const need = await pendingCheck(io, data, state, "blockedEdit");
  // A failed check has its own reason below.
  const failed = failedCheck(state);

  if (need && !(need.why === "static" && failed)) {
    state.blockedEdit = lastEdit.seq;
    if (need.why === "static")
      reason = `${staticCause(lastCheck, `it does not test the change in \`${clip(lastEdit.path, 30)}\``)}. ${testAction(need.test)}, or say that the change is not verified.`;
    else if (lastCheck)
      reason = `Code changed after the last check (last edit: \`${lastEdit.path}\`, last check: \`${lastCheck.command}\`). Run a check that covers it, or say that it is not verified.`;
    else
      reason = `Code changed (last edit: \`${lastEdit.path}\`), and no check ran. Run a check that covers it, or say that it is not verified.`;
  } else if (failed && state.blockedCheck !== failed.seq) {
    state.blockedCheck = failed.seq;
    reason = `The last ${failed === lastCheck ? "check" : "run check"} (\`${failed.command}\`) failed${failed.code ? ` (exit ${failed.code})` : ""}. Fix it, or report it as failing.`;
  }

  if (!reason) return;
  await save(io, data.session_id, agentId, state);
  // The reply written after this becomes the final report, so it has to
  // carry the whole outcome, not only the new check result.
  reason +=
    " Then give the full report again, because your next reply replaces this one.";
  stopFeedback(data, reason);
});
