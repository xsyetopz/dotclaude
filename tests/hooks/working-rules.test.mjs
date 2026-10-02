// The working rules: a SessionStart hook adds them to a new, cleared, or
// compacted main session, and not to a resumed or forked one or a subagent.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { HOOKS, hook } from "../support/hooks.mjs";

const ACTION = "session-start/add-working-rules.mjs";
const rules = fs
  .readFileSync(path.join(HOOKS, "session-start", "working-rules.md"), "utf8")
  .trim();
const start = (input) =>
  hook(ACTION, { hook_event_name: "SessionStart", ...input });

test("a new, cleared, or compacted session gets the working rules", () => {
  for (const source of ["startup", "clear", "compact"]) {
    const out = start({ source }).hookSpecificOutput;
    expect(out.hookEventName).toBe("SessionStart");
    expect(out.additionalContext).toBe(
      `[dotclaude] <working_rules>\n${rules}\n</working_rules>`,
    );
  }
});

test("a resumed or forked session and a subagent get no second copy", () => {
  expect(start({ source: "resume" })).toBe(null);
  expect(start({ source: "fork" })).toBe(null);
  expect(start({ source: "compact", agent_id: "a1" })).toBe(null);
  expect(
    start({
      source: "compact",
      transcript_path: "/s/subagents/agent-a1.jsonl",
    }),
  ).toBe(null);
});
