// SubagentStart hook: mark the subagent as running, so that
// `pre-tool-use/prefer-dotclaude-agents.mjs` can deny an `Agent` call past
// `MAX_CONCURRENT_AGENTS`. The hooks module runs it after `agent.spawn`, and
// each `turn.step` of the agent rewrites its marker (`hooks/register.mjs`),
// so a long or resumed agent stays counted.

import { option } from "../lib/_core.mjs";
import { agentStarted } from "../lib/_ledger.mjs";

export default async function (io, data) {
  if (!option(io.env, "agent_guidance") || !data.session_id || !data.agent_id)
    return;
  await agentStarted(io, data.session_id, data.agent_id);
}
