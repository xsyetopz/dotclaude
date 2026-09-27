// enforce-turn-budget: refuse tool calls when a dotclaude agent nears maxTurns.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hook } from "../support/hooks.mjs";

const prompt = (text, extra = {}) => ({
  type: "user",
  message: { role: "user", content: text },
  ...extra,
});
const call = (n) => ({
  type: "assistant",
  message: { id: `msg_${n}`, content: [{ type: "tool_use", name: "Bash" }] },
});
const result = () => ({
  type: "user",
  message: { content: [{ type: "tool_result", content: "ok" }] },
});
const calls = (from, count) =>
  Array.from({ length: count }, (_, i) => [call(from + i), result()]).flat();

function decide(entries, input = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-budget-"));
  const sub = path.join(dir, "s1", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(
    path.join(sub, "agent-a1.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n"),
  );
  const out = hook("pre-tool-use/enforce-turn-budget.mjs", {
    hook_event_name: "PreToolUse",
    session_id: "s1",
    transcript_path: path.join(dir, "s1.jsonl"),
    agent_id: "a1",
    agent_type: "dotclaude:implementer",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    ...input,
  });
  return out?.hookSpecificOutput?.permissionDecision ?? "pass";
}

const brief = [
  prompt("Implement the slice."),
  prompt("<system-reminder>report via handback</system-reminder>", {
    isMeta: true,
  }),
];

test("implementer (80 turns) is refused tools once 4 remain, but not the report", () => {
  expect(decide([...brief, ...calls(0, 75)])).toBe("pass");
  expect(decide([...brief, ...calls(0, 76)])).toBe("deny");
  expect(
    decide([...brief, ...calls(0, 79)], { tool_name: "SubagentHandback" }),
  ).toBe("pass");
});

test("the count starts again after a wake-up or a resume message, not a reminder", () => {
  const wake = prompt("[SYSTEM NOTIFICATION] task done", {
    isMeta: true,
    origin: { kind: "task-notification" },
  });
  const resume = prompt("The coordinator sent a message", {
    isMeta: true,
    origin: { kind: "coordinator" },
  });
  const reminder = prompt("Your previous response had no visible output", {
    isMeta: true,
  });
  expect(decide([...brief, ...calls(0, 70), wake, ...calls(70, 10)])).toBe(
    "pass",
  );
  expect(decide([...brief, ...calls(0, 80), resume, ...calls(80, 10)])).toBe(
    "pass",
  );
  expect(decide([...brief, ...calls(0, 70), reminder, ...calls(70, 10)])).toBe(
    "deny",
  );
});

test("other agents, missing transcripts, and the option switch pass", () => {
  const full = [...brief, ...calls(0, 80)];
  expect(decide(full, { agent_type: "general-purpose" })).toBe("pass");
  expect(decide(full, { agent_id: "missing" })).toBe("pass");
  expect(decide(full, { agent_id: "agent-a1" }), "prefixed id").toBe("deny");
  const out = hook(
    "pre-tool-use/enforce-turn-budget.mjs",
    { agent_type: "dotclaude:implementer", agent_id: "a1" },
    { CLAUDE_PLUGIN_OPTION_TURN_LIMIT_HANDOFF: "false" },
  );
  expect(out).toBeNull();
});
