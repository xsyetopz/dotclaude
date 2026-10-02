// The agent PreToolUse actions on the io seam: the context budget and the
// subagent model lock.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SUBAGENT_WRAP_UP_TOKENS,
  subagentContextTokens,
} from "../../hooks/lib/_budget.mjs";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";
import budget from "../../hooks/pre-tool-use/enforce-agent-budget.mjs";
import models from "../../hooks/pre-tool-use/restrict-subagent-models.mjs";

function budgetIo(overrides = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-data-"));
  return {
    ...nodeIo(),
    env: { CLAUDE_PLUGIN_DATA: data },
    session: {
      agentContext: async () => ({ first: 0, last: 10_000_000 }),
      agentTurns: async () => null,
    },
    ...overrides,
  };
}

test("an empty engine cwd denies a past-budget delete, and does not throw", async () => {
  // The engine can give `cwd: ""`. The pure posix `resolve` throws on it.
  const io = budgetIo({ platform: "posix", cwd: "" });
  const out = await budget(io, {
    agent_id: "a1",
    agent_type: "x",
    tool_name: "Bash",
    cwd: "",
    tool_input: { command: "rm /tmp/scratch.txt" },
  });
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("the wrap-up marker name keeps the session ID inside the state folder", async () => {
  // Put the context inside the wrap-up band, just under the cap.
  const last = subagentContextTokens("x") - SUBAGENT_WRAP_UP_TOKENS + 1;
  const io = budgetIo({
    session: {
      agentContext: async () => ({ first: 0, last }),
      agentTurns: async () => null,
    },
  });
  const data = { agent_id: "a1", agent_type: "x", session_id: "../../escape" };
  const out = await budget(io, data);
  expect(out.hookSpecificOutput.additionalContext).toContain("Finish");
  const base = io.env.CLAUDE_PLUGIN_DATA;
  expect(fs.readdirSync(base)).toEqual(["sessions"]);
  // The marker is created once, so the second call gives no note.
  expect(await budget(io, data)).toBeUndefined();
});

test("Fable behind a family alias is blocked for subagents", async () => {
  for (const alias of ["opus", "sonnet", "haiku"]) {
    const env = {
      [`ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`]: "claude-fable-5-1",
    };
    const out = await models(
      { ...nodeIo(), env },
      {
        tool_name: "Agent",
        tool_input: { model: alias, prompt: "x" },
      },
    );
    expect(out?.hookSpecificOutput?.permissionDecision, alias).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("Fable");
  }
  // `fable` mapped to another model is checked as that model.
  const mapped = await models(
    { ...nodeIo(), env: { ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-opus-5-5" } },
    { tool_name: "Agent", tool_input: { model: "fable", prompt: "x" } },
  );
  expect(
    mapped?.hookSpecificOutput?.permissionDecisionReason ?? "",
  ).not.toContain("blocks Fable");
});
