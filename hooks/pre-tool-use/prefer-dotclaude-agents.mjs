#!/usr/bin/env bun
// PreToolUse(Agent): refuse `general-purpose`, and run every other subagent
// in the foreground.
//
// general-purpose: in the week of 2026-09-21 these agents were 17.5% of
// spend, 83 explicit calls, almost all implementation slices with no turn
// limit. The dotclaude agents carry a model, effort, turn limit, and tool set
// for their job. With forks off (the settings profile sets
// CLAUDE_CODE_FORK_SUBAGENT=0), leaving `subagent_type` out also spawns
// general-purpose, so that is refused too; with forks on it spawns a fork.
//
// Foreground: a background agent wakes the main conversation when it
// finishes, once for its report and once more for the task notification,
// and each wake is a full turn over the main context. Those wakes were 501
// main turns and $385 in the same week, more turns than the user started. A
// foreground agent returns its report as the tool result of the turn that
// spawned it, and agents spawned in one message still run together. Claude
// Code applies `updatedInput` only with an allow or ask decision; a deny from
// another hook or a settings deny rule still wins over this allow.
//
// Concurrency: with `MAX_CONCURRENT_AGENTS` subagents running, the call is
// denied before Claude Code refuses it with `Concurrent subagent limit
// reached`. The count comes from `SubagentStart` and `SubagentStop`. Resumes
// and `/subtask` forks bypass Claude Code's own count, so this check only
// denies when it counted the running agents itself.

import {
  MAX_CONCURRENT_AGENTS,
  RUNNING_AGENT_IDLE_MINUTES,
} from "../lib/_budget.mjs";
import { emit, option, preToolDecision, run } from "../lib/_common.mjs";
import { runningAgents } from "../lib/_ledger.mjs";
import { logVerdict } from "../lib/_verdicts.mjs";

const OFF = new Set(["0", "false", "no", "off"]);

const AGENTS =
  "Use the dotclaude agent for the job instead. Use `dotclaude:implementer` for a scoped code change and `dotclaude:mechanical-worker` for fully specified edits. Use `dotclaude:debugger` for an unknown cause and `dotclaude:docs-writer` for docs. Use `dotclaude:web-researcher` for the web and `dotclaude:test-runner` for long test output. Do a search yourself. Draft a plan yourself, in plan mode. Then have `dotclaude:plan-reviewer` review it. An implementer builds from a plan, and it uses all of its context when it has to write one. For work too large for one agent, split it into slices.";

run((data) => {
  if (!option("subagent_guidance")) return;
  const input = data.tool_input ?? {};
  const forksOff = OFF.has(
    String(process.env.CLAUDE_CODE_FORK_SUBAGENT ?? "").toLowerCase(),
  );
  const type = input.subagent_type;
  if (type === "general-purpose" || (!type && forksOff)) {
    preToolDecision(
      "deny",
      `\`general-purpose\` has no turn limit and every tool. ${AGENTS}`,
    );
    return;
  }
  const running = data.session_id
    ? runningAgents(data.session_id, RUNNING_AGENT_IDLE_MINUTES * 60_000)
    : 0;
  if (running >= MAX_CONCURRENT_AGENTS) {
    const reason = `${running} subagents run now, and the limit is ${MAX_CONCURRENT_AGENTS} at once. Claude Code refuses a start past the limit. Wait until one agent reports, with \`Monitor\` if it runs in the background. Then send the next agents as a new wave.`;
    logVerdict(data, "deny", reason);
    preToolDecision("deny", reason);
    return;
  }
  if (input.run_in_background === false) return;
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      // No reason: the user would see it on every spawn.
      permissionDecision: "allow",
      updatedInput: { ...input, run_in_background: false },
    },
  });
});
