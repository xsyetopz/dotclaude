#!/usr/bin/env bun
// SubagentStart hook: mark the subagent as running, so that
// `pre-tool-use/prefer-dotclaude-agents.mjs` can deny an `Agent` call past
// `MAX_CONCURRENT_AGENTS`. A resume starts the same agent again and rewrites
// its marker.

import { option, run } from "../lib/_common.mjs";
import { agentStarted } from "../lib/_ledger.mjs";

run((data) => {
  if (!option("agent_guidance") || !data.session_id || !data.agent_id) return;
  agentStarted(data.session_id, data.agent_id, data.transcript_path);
});
