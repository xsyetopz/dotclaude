// SubagentStart hook: mark the subagent as running, so that
// `pre-tool-use/prefer-dotclaude-agents.mjs` can deny an `Agent` call past
// `MAX_CONCURRENT_AGENTS`. A resume starts the same agent again and rewrites
// its marker.

import { option } from "../lib/_core.mjs";
import { agentStarted } from "../lib/_ledger.mjs";

export default async function (io, data) {
  if (!option(io.env, "agent_guidance") || !data.session_id || !data.agent_id)
    return;
  await agentStarted(io, data.session_id, data.agent_id);
}
