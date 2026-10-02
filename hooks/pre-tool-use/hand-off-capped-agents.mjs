// PreToolUse(SendMessage): an agent that stopped at its turn limit is not
// resumed. Its context has grown with every turn and each further turn
// re-reads all of it, while a fresh agent briefed from a report starts small.
// Claude Code delivers no report from an agent cut off at its limit, so the
// first message to it is rewritten into a request for a handoff report; any
// later message is denied, pointing at a fresh agent instead.

import { option, preToolOutput, stateDir } from "../lib/_core.mjs";
import { pathFor } from "../lib/_path.mjs";

const REPORT_REQUEST =
  "You stopped at your turn limit, and a fresh agent will continue this work. Make no more tool calls. Reply now with your final report as a handoff. Include the goal, what you did, and how you verified it (commands and results). Include the files you changed and anything you left half-edited or uncommitted. Include the work that remains, in order, and anything the next agent must know.";

function statePath(io, sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  return pathFor(io.platform).join(stateDir(io), `${safe}.capped-agents.json`);
}

async function readState(io, file) {
  try {
    const value = JSON.parse(await io.fs.read(file));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export default async function (io, data) {
  if (!option(io.env, "usage_agent_bounds")) return;
  const input = data.tool_input ?? {};
  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(to)) return;
  const file = statePath(io, data.session_id);
  const reported = await readState(io, file);
  if (reported.includes(to))
    return preToolOutput(
      "deny",
      `Agent \`${to}\` stopped at its turn limit, and dotclaude already asked it for its handoff report. Resuming it re-reads its whole context on every turn. Start a fresh agent of the same type instead, briefed from that report (goal, what is done, the files, what remains). If the report never arrived, read the agent's output file named in its task notification.`,
    );
  if (!(await io.session.agentStoppedAtLimit(to))) return;
  await io.fs.write(file, JSON.stringify([...reported, to]));
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason:
        "The agent stopped at its turn limit, so this message asks only for its handoff report.",
      updatedInput: { ...input, message: REPORT_REQUEST },
      additionalContext: `This hook replaced the message to \`${to}\` with a request for its handoff report, because it stopped at its turn limit. When the report arrives, continue the work with a fresh agent of the same type, briefed from it. This hook blocks further messages to \`${to}\`.`,
    },
  };
}
