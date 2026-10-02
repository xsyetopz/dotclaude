#!/usr/bin/env bun

// SubagentStart hook: mark the subagent as running, so that
// `pre-tool-use/prefer-dotclaude-agents.mjs` can deny an `Agent` call past
// `MAX_CONCURRENT_AGENTS`. A resume starts the same agent again and rewrites
// its marker.

import { run } from "../lib/_common.mjs";
import { option } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { agentStarted } from "../lib/_ledger.mjs";

run(async (data) => {
  if (
    !option(process.env, "agent_guidance") ||
    !data.session_id ||
    !data.agent_id
  )
    return;
  await agentStarted(nodeIo(data), data.session_id, data.agent_id);
});
