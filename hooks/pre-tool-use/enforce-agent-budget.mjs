#!/usr/bin/env bun

// PreToolUse (all tools) in subagents: refuse tool calls once the agent's
// context passes dotclaude's budget for its type (any agent type), or once only a
// few turns of a dotclaude agent's `maxTurns` remain, so the next action is a
// report. Every turn re-reads the whole context, so most of a long agent's
// cost comes from its late turns; a fresh agent briefed from the report
// starts small. Claude Code delivers nothing from an agent cut off at its
// turn limit, and asking agents to report early did not work: every capped
// run after 0.5.0 added that request was still calling tools when it stopped.

import fs from "node:fs";
import path from "node:path";
import {
  contextUsed,
  definition,
  reserve,
  turnsUsed,
} from "../lib/_agents.mjs";
import { isUnder } from "../lib/_bash-args.mjs";
import {
  k,
  SUBAGENT_CONTEXT_GROWTH,
  SUBAGENT_WRAP_UP_TOKENS,
  subagentContextTokens,
} from "../lib/_budget.mjs";
import {
  emit,
  option,
  preToolDecision,
  run,
  stateDir,
} from "../lib/_common.mjs";
import { isTempChild } from "../lib/_rules-filesystem.mjs";
import { parse } from "../lib/_shell.mjs";
import { subagentTranscript } from "../lib/_transcript.mjs";

const REPORT =
  "Make no more tool calls. Your next action is your report. Give the answer or result so far, what you changed, and what ran and its result. If work remains, add a handoff for a fresh agent: anything half-edited, and what is left in order.";

/**
 * A Bash command that only deletes named paths inside a temp folder: the
 * agent's scratch cleanup, which its brief asks for before the report.
 */
function deletesTempOnly(data) {
  if (data.tool_name !== "Bash") return false;
  const { commands, unparsed } = parse(String(data.tool_input?.command ?? ""));
  if (unparsed.length || !commands.length) return false;
  const cwd = data.cwd ?? "/";
  // A project can itself sit in a temp folder. Its files are not scratch.
  const project = path.resolve(process.env.CLAUDE_PROJECT_DIR || cwd);
  return commands.every((cmd) => {
    if (cmd.name !== "rm" || cmd.cwdHint) return false;
    const paths = cmd.args.filter((a) => !a.startsWith("-"));
    return (
      paths.length > 0 &&
      paths.every((p) => {
        const abs = path.resolve(cwd, p);
        return (
          !/[$~*?[]|__SUBST__/.test(p) &&
          !p.split("/").includes("..") &&
          isTempChild(abs) &&
          !isUnder(abs, project)
        );
      })
    );
  });
}

/** True the first time this agent passes `mark`. */
function firstTime(data, mark) {
  const file = path.join(
    stateDir(),
    `${data.session_id}.${String(data.agent_id).replace(/[^\w-]/g, "_")}.${mark}`,
  );
  if (fs.existsSync(file)) return false;
  fs.writeFileSync(file, "");
  return true;
}

run((data) => {
  if (!option("usage_agent_bounds")) return;
  // The report tool must stay open, or the agent could not deliver it.
  if (data.tool_name === "SubagentHandback") return;
  if (!data.agent_id || !data.transcript_path || !data.session_id) return;
  const transcript = subagentTranscript(
    data.transcript_path,
    data.session_id,
    data.agent_id,
  );
  const context = contextUsed(transcript);
  if (context) {
    // A fork starts with the parent's context, so it gets room to grow.
    const cap = Math.max(
      subagentContextTokens(data.agent_type),
      context.first + SUBAGENT_CONTEXT_GROWTH,
    );
    if (context.last >= cap && deletesTempOnly(data)) return;
    if (context.last >= cap) {
      preToolDecision(
        "deny",
        `context budget: this agent's context is ${k(context.last)} tokens, past dotclaude's ${k(cap)} limit, and each further turn re-reads all of it. ${REPORT}`,
      );
      return;
    }
    if (
      context.last >= cap - SUBAGENT_WRAP_UP_TOKENS &&
      firstTime(data, "wrap-up")
    ) {
      emit({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: `This agent's context is ${k(context.last)} tokens. At ${k(cap)}, dotclaude refuses further tool calls, because each turn re-reads the whole context. Finish the current item, delete your scratch files, and then report. Do not start a new item. Put the items that are not done in the report as a handoff for a fresh agent.`,
        },
      });
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
