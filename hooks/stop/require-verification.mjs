#!/usr/bin/env bun
// Stop and SubagentStop hook: send Claude (or a subagent) back once when it
// ends after code edits with no later check run, or with a failed check it
// reports as passing. Each ledger state blocks at most once, and a
// continuation is never blocked again. A pass claim with nothing edited and
// nothing run is not blocked: read-only agents quote results that others ran.

import { emit, option, run } from "../lib/_common.mjs";
import { load, save } from "../lib/_ledger.mjs";

const CLAIMS_PASS =
  /\b(all\s+)?(tests?|specs?|checks?|builds?|suite|lint(ing)?|type-?checks?)\s+(now\s+)?(pass(es|ed|ing)?|succeed(s|ed)?|(are|is)\s+(green|passing|clean)|green)\b|\b\d+\s+passed\b|\bverified\b/i;
// A reply that says outright the change was not checked. Mentioning an error
// or failure the change fixed ("fixed the parser error") is not that.
const SAYS_UNVERIFIED =
  /\b(not\s+(yet\s+)?(run|ran|verified|tested|checked)|unverified|untested|didn'?t\s+(run|test|verify|check)|haven'?t\s+(run|tested|verified|checked)|could\s?n[o']t\s+(run|test|verify|check)|without\s+(running|testing|verifying))\b/i;
// A reply that reports a failure or a gap, which is honest after a failed check.
const ADMITS_GAP =
  /\b(fail(s|ed|ing|ure)?|error|broken|not\s+(yet\s+)?(run|ran|verified|tested)|unverified|untested|didn'?t\s+(run|test|verify)|haven'?t\s+(run|tested|verified)|could\s?n[o']t\s+(run|test))\b/i;

/** `message` without quoted lines (`>`) and code (fenced or in backticks). */
function ownWords(message) {
  return message
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

run((data) => {
  if (!option("stop_gate") || data.stop_hook_active) return;
  if (
    (data.background_tasks ?? []).some(
      (t) => t.type === "shell" || t.type === "subagent",
    )
  )
    return;
  // SubagentStop checks the subagent's own ledger (edits it made, checks it ran).
  const agentId =
    data.hook_event_name === "SubagentStop" ? data.agent_id : null;
  const state = load(data.session_id, agentId);
  const message = data.last_assistant_message ?? "";
  const { lastEdit, lastCheck } = state;
  let reason;

  if (
    lastEdit &&
    (!lastCheck || lastCheck.seq < lastEdit.seq) &&
    state.blockedEdit !== lastEdit.seq &&
    !SAYS_UNVERIFIED.test(message)
  ) {
    state.blockedEdit = lastEdit.seq;
    reason = lastCheck
      ? `Code changed after the last check run (last edit: \`${lastEdit.path}\`, last check: \`${lastCheck.command}\`). Run the tests, build, or lint that cover this change. Otherwise, say in your reply that the change is unverified, and give the reason.`
      : `Code changed (last edit: \`${lastEdit.path}\`), and no test, build, or lint command ran this session. Run the tests, build, or lint that cover this change. Otherwise, say in your reply that the change is unverified, and give the reason.`;
  } else if (
    lastCheck &&
    lastCheck.ok === false &&
    (!lastEdit || lastCheck.seq > lastEdit.seq) &&
    state.blockedCheck !== lastCheck.seq &&
    CLAIMS_PASS.test(ownWords(message)) &&
    !ADMITS_GAP.test(message)
  ) {
    state.blockedCheck = lastCheck.seq;
    reason = `The last check (\`${lastCheck.command}\`) failed${lastCheck.code ? ` with exit code ${lastCheck.code}` : ""}, and no check passed after it, but the reply describes it as passing. Fix the failure, or report it as failing.`;
  }

  if (!reason) return;
  save(data.session_id, agentId, state);
  // The reply written after this becomes the final report, so it has to
  // carry the whole outcome, not only the new check result.
  reason +=
    " Then write the complete report again at the end (what changed, what ran and its result). Your next reply replaces this one as the report.";
  emit({ decision: "block", reason });
});
