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

import { emit, option, preToolDecision, run } from "../lib/_common.mjs";

const OFF = new Set(["0", "false", "no", "off"]);

const AGENTS =
  "use the dotclaude agent for the job instead: `dotclaude:implementer` for a scoped code change, `dotclaude:mechanical-worker` for fully specified edits, `dotclaude:debugger` for an unknown cause, `dotclaude:docs-writer` for docs, `dotclaude:web-researcher` for the web, and `dotclaude:test-runner` for long test output. Do a search yourself. For work too large for one agent, split it into slices.";

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
      `\`general-purpose\` has no turn limit and every tool. Instead, ${AGENTS}`,
    );
    return;
  }
  if (input.run_in_background === false) return;
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason:
        "dotclaude runs subagents in the foreground: a background agent wakes the main conversation when it finishes, and each wake is a full turn.",
      updatedInput: { ...input, run_in_background: false },
    },
  });
});
