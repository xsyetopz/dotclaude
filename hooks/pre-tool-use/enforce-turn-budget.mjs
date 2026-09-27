#!/usr/bin/env bun
// PreToolUse (all tools) in dotclaude agents: refuse tool calls once only a
// few turns of the agent's `maxTurns` remain, so the next action is a report.
// Claude Code delivers nothing from an agent cut off at its limit, and asking
// agents to report early did not work: every capped run after 0.5.0 added
// that request was still calling tools when it stopped.

import path from "node:path";
import { definition, reserve, turnsUsed } from "../lib/_agents.mjs";
import { option, preToolDecision, run } from "../lib/_common.mjs";

run((data) => {
  if (!option("turn_limit_handoff")) return;
  // The report tool must stay open, or the agent could not deliver it.
  if (data.tool_name === "SubagentHandback") return;
  const limit = definition(String(data.agent_type ?? ""))?.maxTurns;
  if (!limit || !data.agent_id || !data.transcript_path || !data.session_id)
    return;
  const id = String(data.agent_id).replace(/^agent-/, "");
  const transcript = path.join(
    path.dirname(data.transcript_path),
    String(data.session_id),
    "subagents",
    `agent-${id}.jsonl`,
  );
  const used = turnsUsed(transcript);
  if (used === null || used < limit - reserve(limit)) return;
  preToolDecision(
    "deny",
    `turn budget: ${used} of ${limit} turns used. Make no more tool calls. Your next action is your report: the answer or result so far, what you changed, what ran and its result, and, if work remains, a handoff (anything half-edited, what is left in order) for a fresh agent.`,
  );
});
