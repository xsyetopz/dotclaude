#!/usr/bin/env bun
// PreToolUse (all tools) in subagents: refuse tool calls once the agent's
// context passes dotclaude's subagent budget (any agent type), or once only a
// few turns of a dotclaude agent's `maxTurns` remain, so the next action is a
// report. Every turn re-reads the whole context, so most of a long agent's
// cost comes from its late turns; a fresh agent briefed from the report
// starts small. Claude Code delivers nothing from an agent cut off at its
// turn limit, and asking agents to report early did not work: every capped
// run after 0.5.0 added that request was still calling tools when it stopped.

import path from "node:path";
import {
  contextUsed,
  definition,
  reserve,
  turnsUsed,
} from "../lib/_agents.mjs";
import {
  k,
  SUBAGENT_CONTEXT_GROWTH,
  SUBAGENT_CONTEXT_TOKENS,
} from "../lib/_budget.mjs";
import { option, preToolDecision, run } from "../lib/_common.mjs";

const REPORT =
  "Make no more tool calls. Your next action is your report: the answer or result so far, what you changed, what ran and its result, and, if work remains, a handoff (anything half-edited, what is left in order) for a fresh agent.";

run((data) => {
  if (!option("turn_limit_handoff")) return;
  // The report tool must stay open, or the agent could not deliver it.
  if (data.tool_name === "SubagentHandback") return;
  if (!data.agent_id || !data.transcript_path || !data.session_id) return;
  const id = String(data.agent_id).replace(/^agent-/, "");
  const transcript = path.join(
    path.dirname(data.transcript_path),
    String(data.session_id),
    "subagents",
    `agent-${id}.jsonl`,
  );
  const context = contextUsed(transcript);
  if (context) {
    // A fork starts with the parent's context, so it gets room to grow.
    const cap = Math.max(
      SUBAGENT_CONTEXT_TOKENS,
      context.first + SUBAGENT_CONTEXT_GROWTH,
    );
    if (context.last >= cap) {
      preToolDecision(
        "deny",
        `context budget: this agent's context is ${k(context.last)} tokens, past dotclaude's ${k(cap)} limit, and each further turn re-reads all of it. ${REPORT}`,
      );
      return;
    }
  }
  const limit = definition(String(data.agent_type ?? ""))?.maxTurns;
  if (!limit) return;
  const used = turnsUsed(transcript);
  if (used === null || used < limit - reserve(limit)) return;
  preToolDecision(
    "deny",
    `turn budget: ${used} of ${limit} turns used. ${REPORT}`,
  );
});
