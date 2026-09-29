#!/usr/bin/env bun
// SubagentStop hook: remove the subagent's running marker. When the stop gate
// sends the agent back, the agent runs on without a marker, so the count is
// low by one until it stops. A low count only lets Claude Code refuse the
// call itself.

import { run } from "../lib/_common.mjs";
import { agentStopped } from "../lib/_ledger.mjs";

run((data) => {
  if (!data.session_id || !data.agent_id) return;
  agentStopped(data.session_id, data.agent_id);
});
