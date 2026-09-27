// Subagent start guidance injection.

import { expect, test } from "bun:test";
import { hook } from "../support/hooks.mjs";

test("subagent guidance is injected, skipped for the reviewer, and can be turned off", () => {
  const out = hook("subagent-start/inject-working-conventions.mjs", {
    hook_event_name: "SubagentStart",
    agent_id: "a1",
    agent_type: "general-purpose",
  });
  expect(out.hookSpecificOutput.hookEventName).toBe("SubagentStart");
  expect(out.hookSpecificOutput.additionalContext).toMatch(/hypotheses/);
  expect(out.hookSpecificOutput.additionalContext).toMatch(
    /Only your final message is delivered/,
  );
  expect(out.hookSpecificOutput.additionalContext).not.toMatch(/turn_budget/);
  const start = (agentType) =>
    hook("subagent-start/inject-working-conventions.mjs", {
      hook_event_name: "SubagentStart",
      agent_type: agentType,
    }).hookSpecificOutput.additionalContext;
  // Every dotclaude agent learns its turn limit; the ones with their own
  // prompt get only that.
  const implementer = start("dotclaude:implementer");
  expect(implementer).toMatch(/hypotheses/);
  expect(implementer).toMatch(/at most 80 turns\. When about 8 remain/);
  for (const [agentType, limit] of [
    ["dotclaude:code-reviewer", 40],
    ["dotclaude:codex-worker", 12],
  ]) {
    const text = start(agentType);
    expect(text, agentType).not.toMatch(/hypotheses/);
    expect(text, agentType).toMatch(new RegExp(`at most ${limit} turns`));
  }
  expect(
    hook(
      "subagent-start/inject-working-conventions.mjs",
      { hook_event_name: "SubagentStart", agent_type: "Explore" },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_GUIDANCE: "false" },
    ),
  ).toBe(null);
});
