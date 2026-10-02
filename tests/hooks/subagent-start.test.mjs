// Subagent start guidance injection.

import { expect, test } from "bun:test";
import {
  k,
  LIMITS,
  REVIEWER_CONTEXT_TOKENS,
  SUBAGENT_CONTEXT_TOKENS,
} from "../../hooks/lib/_budget.mjs";
import { hook } from "../support/hooks.mjs";

const CONVENTIONS = '<working_conventions source="dotclaude">';

/** The text of the `<tag source="dotclaude">` block, or undefined. */
function block(text, tag) {
  return text.match(
    new RegExp(`<${tag} source="dotclaude">([\\s\\S]*?)</${tag}>`),
  )?.[1];
}

/** The whole numbers a block states, in order. */
const numbers = (text) => (text ?? "").match(/\d+/g)?.map(Number) ?? [];

test("subagent guidance is injected, skipped for the reviewer, and can be turned off", () => {
  const out = hook("subagent-start/inject-working-conventions.mjs", {
    hook_event_name: "SubagentStart",
    agent_id: "a1",
    agent_type: "general-purpose",
  });
  expect(out.hookSpecificOutput.hookEventName).toBe("SubagentStart");
  const context = out.hookSpecificOutput.additionalContext;
  expect(context).toContain(CONVENTIONS);
  expect(block(context, "working_conventions")?.trim()).toBeTruthy();
  // Every subagent start carries this block, so it stays short.
  expect(block(context, "working_conventions").length).toBeLessThanOrEqual(
    LIMITS.sessionNoteChars.fail,
  );
  expect(context).not.toMatch(/turn_budget/);
  expect(block(context, "context_budget")).toContain(
    k(SUBAGENT_CONTEXT_TOKENS),
  );
  const start = (agentType) =>
    hook("subagent-start/inject-working-conventions.mjs", {
      hook_event_name: "SubagentStart",
      agent_type: agentType,
    }).hookSpecificOutput.additionalContext;
  // Every dotclaude agent learns its turn limit; the ones with their own
  // prompt get only that.
  const implementer = start("dotclaude:implementer");
  expect(implementer).toContain(CONVENTIONS);
  // The limit from the agent file, then the turns kept for the report.
  const implementerBudget = numbers(block(implementer, "turn_budget"));
  expect(implementerBudget).toContain(80);
  expect(implementerBudget).toContain(4);
  const reviewer = start("dotclaude:reviewer");
  expect(reviewer).not.toContain(CONVENTIONS);
  expect(numbers(block(reviewer, "turn_budget"))).toContain(60);
  expect(block(reviewer, "context_budget")).toContain(
    k(REVIEWER_CONTEXT_TOKENS),
  );
  // The read-only investigator keeps the conventions and the common bound.
  const investigator = start("dotclaude:investigator");
  expect(investigator).toContain(CONVENTIONS);
  expect(numbers(block(investigator, "turn_budget"))).toContain(40);
  expect(block(investigator, "context_budget")).toContain(
    k(SUBAGENT_CONTEXT_TOKENS),
  );
  expect(
    hook(
      "subagent-start/inject-working-conventions.mjs",
      { hook_event_name: "SubagentStart", agent_type: "Explore" },
      { CLAUDE_PLUGIN_OPTION_AGENT_GUIDANCE: "false" },
    ),
  ).toBe(null);
});
