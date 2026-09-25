#!/usr/bin/env bun
// Stop hook: send Claude back once when the turn ends after code edits with no
// later check run, or with a failed check it reports as passing. Each ledger
// state blocks at most once, and a continuation is never blocked again.

import { emit, option, run } from "../lib/_common.mjs";
import { load, save } from "../lib/_ledger.mjs";

const CLAIMS_PASS =
  /\b(all\s+)?(tests?|specs?|checks?|builds?|suite|lint(ing)?|type-?checks?)\s+(now\s+)?(pass(es|ed|ing)?|succeed(s|ed)?|(are|is)\s+(green|passing|clean)|green)\b|\b\d+\s+passed\b|\bverified\b/i;
const ADMITS_GAP =
  /\b(fail(s|ed|ing|ure)?|error|broken|not\s+(yet\s+)?(run|ran|verified|tested)|unverified|untested|didn'?t\s+(run|test|verify)|haven'?t\s+(run|tested|verified)|could\s?n[o']t\s+(run|test))\b/i;

run((data) => {
  if (!option("stop_gate") || data.stop_hook_active) return;
  if (
    (data.background_tasks ?? []).some(
      (t) => t.type === "shell" || t.type === "subagent",
    )
  )
    return;
  const state = load(data.session_id, null);
  const message = data.last_assistant_message ?? "";
  const { lastEdit, lastCheck } = state;
  let reason = null;

  if (
    lastEdit &&
    (!lastCheck || lastCheck.seq < lastEdit.seq) &&
    state.blockedEdit !== lastEdit.seq &&
    !ADMITS_GAP.test(message)
  ) {
    state.blockedEdit = lastEdit.seq;
    reason = lastCheck
      ? `Code changed after the last check run (last edit: ${lastEdit.path}; last check: \`${lastCheck.command}\`). Run the tests, build, or lint that cover this change, or state in your reply that the change is unverified and why.`
      : `Code changed (last edit: ${lastEdit.path}) and no test, build, or lint command ran this session. Run the checks that cover this change, or state in your reply that the change is unverified and why.`;
  } else if (
    lastCheck &&
    lastCheck.ok === false &&
    (!lastEdit || lastCheck.seq > lastEdit.seq) &&
    state.blockedCheck !== lastCheck.seq &&
    CLAIMS_PASS.test(message) &&
    !ADMITS_GAP.test(message)
  ) {
    state.blockedCheck = lastCheck.seq;
    reason = `The last check (\`${lastCheck.command}\`) failed${lastCheck.code ? ` with exit code ${lastCheck.code}` : ""} and nothing has passed since, but the reply describes it as passing. Fix the failure, or report it as failing.`;
  } else if (
    !lastCheck &&
    !lastEdit &&
    CLAIMS_PASS.test(message) &&
    state.blockedCheck !== "claim"
  ) {
    state.blockedCheck = "claim";
    reason =
      "The reply says tests or a build passed, but no test or build command ran this session. Run it, or reword the reply to say what was actually checked.";
  }

  if (!reason) return;
  save(data.session_id, null, state);
  emit({ decision: "block", reason });
});
