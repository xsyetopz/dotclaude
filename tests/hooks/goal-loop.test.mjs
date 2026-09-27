// Ending a /goal check loop that makes no progress.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { isolatedHook as hook, tmp } from "../support/hooks.mjs";

test("a /goal check loop with no work in between ends after two blocks", () => {
  const line = (r) => JSON.stringify(r);
  const feedback = {
    type: "user",
    isMeta: true,
    message: {
      content: "Stop hook feedback:\n[Goal: finish R01-R16]\n\nunmet",
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
    fs.writeFileSync(file, records.map(line).join("\n"));
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
  expect(run([worked, said, feedback, said]), "one block passes").toBe(null);
  const stopped = run([worked, said, feedback, said, feedback, said]);
  expect(stopped.continue).toBe(false);
  expect(stopped.stopReason).toMatch(/^\[dotclaude\] .*\/goal clear/);
  expect(
    run([said, feedback, said, worked, feedback, said]),
    "a tool call between blocks means work is happening",
  ).toBe(null);
  expect(
    run([worked, said, feedback, said, feedback, said], {
      CLAUDE_PLUGIN_OPTION_GOAL_LOOP_GUARD: "false",
    }),
  ).toBe(null);
});
