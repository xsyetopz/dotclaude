#!/usr/bin/env bun

// Stop and SubagentStop hook: send Claude (or a subagent) back once when it
// ends after code edits with no later check run, or when the last check
// after its edits failed.
// An edit with no check passes when the project names no test command,
// because then Claude cannot run a check, and the gate would only add a turn.
// A failed check with no edit passes, because a read-only agent such as
// `test-runner` reports failures.
// Each ledger state blocks at most once, and a continuation is never blocked again.
// The hook reads only the ledger, not the reply, because a reply can be in any language.

import { run, stopFeedback } from "../lib/_common.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { load, save } from "../lib/_ledger.mjs";
import { findTestCommand } from "../lib/_test-command.mjs";

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

  if (
    lastEdit &&
    (!lastCheck || lastCheck.seq < lastEdit.seq) &&
    state.blockedEdit !== lastEdit.seq &&
    (await findTestCommand(io, projectRoot(io, data)))
  ) {
    state.blockedEdit = lastEdit.seq;
    reason = lastCheck
      ? `Code changed after the last check (last edit: \`${lastEdit.path}\`, last check: \`${lastCheck.command}\`). Run a check that covers it, or say that it is not verified.`
      : `Code changed (last edit: \`${lastEdit.path}\`), and no check ran. Run a check that covers it, or say that it is not verified.`;
  } else if (
    lastCheck &&
    lastCheck.ok === false &&
    lastEdit &&
    lastCheck.seq > lastEdit.seq &&
    state.blockedCheck !== lastCheck.seq
  ) {
    state.blockedCheck = lastCheck.seq;
    reason = `The last check (\`${lastCheck.command}\`) failed${lastCheck.code ? ` (exit ${lastCheck.code})` : ""}. Fix it, or report it as failing.`;
  }

  if (!reason) return;
  await save(io, data.session_id, agentId, state);
  // The reply written after this becomes the final report, so it has to
  // carry the whole outcome, not only the new check result.
  reason +=
    " Then give the full report again, because your next reply replaces this one.";
  stopFeedback(data, reason);
});
