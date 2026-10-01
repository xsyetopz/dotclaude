// Ending a /goal check loop that makes no progress.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { isolatedHook as hook, tmp } from "../support/hooks.mjs";

test("a /goal check loop with no work in between ends after two blocks", () => {
  const line = (r) => JSON.stringify(r);
  // Claude Code 2.1.283 writes each failed goal check as a meta blocked
  // message that starts with the condition, then a goal_status attachment.
  const blocked = [
    {
      type: "user",
      isMeta: true,
      message: { content: "Stop hook blocked:\n[@GOAL.md]: unmet" },
    },
    {
      type: "attachment",
      attachment: { type: "goal_status", met: false, condition: "@GOAL.md" },
    },
  ];
  const otherHook = {
    type: "user",
    isMeta: true,
    message: { content: "Stop hook blocked:\n[dotclaude] Code changed" },
  };
  const goalSet = {
    type: "attachment",
    attachment: {
      type: "goal_status",
      met: false,
      sentinel: true,
      condition: "@GOAL.md",
    },
  };
  const said = {
    type: "assistant",
    message: { content: [{ type: "text", text: "Stopping." }] },
  };
  const worked = {
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
  };
  const run = (records, env = {}) => {
    const file = path.join(tmp("dotclaude-goal-"), "t.jsonl");
    fs.writeFileSync(file, records.flat().map(line).join("\n"));
    return hook(
      "stop/end-goal-loops.mjs",
      {
        hook_event_name: "Stop",
        stop_hook_active: true,
        transcript_path: file,
      },
      env,
    );
  };
  expect(run([worked, said, blocked, said]), "one block passes").toBe(null);
  const stopped = run([worked, said, blocked, said, blocked, said]);
  expect(stopped.continue).toBe(false);
  expect(stopped.stopReason).toMatch(/^\[dotclaude\] .*\/goal clear/);
  expect(
    run([said, blocked, said, worked, blocked, said]),
    "a tool call between blocks means work is happening",
  ).toBe(null);
  expect(
    run([worked, goalSet, said, otherHook, said, blocked, said]),
    "setting a goal and other hooks' blocks are not goal checks",
  ).toBe(null);
  expect(
    run([worked, said, blocked, said, blocked, said], {
      CLAUDE_PLUGIN_OPTION_GATE_GOAL_STALL: "false",
    }),
  ).toBe(null);
});
