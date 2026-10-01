// Turn-limit handoffs for capped agents, run as Claude Code runs hooks.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { isolatedHook as hook, tmp } from "../support/hooks.mjs";

/** A main transcript whose agent `id` stopped at its turn limit. */
function cappedTranscript(id) {
  const file = path.join(tmp("dotclaude-transcript-"), "main.jsonl");
  const note = `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent "Slice" stopped at its 80-turn limit (partial result; SendMessage to task-id to continue)</summary>\n</task-notification>`;
  fs.writeFileSync(
    file,
    `${JSON.stringify({ type: "queue-operation", content: note })}\n`,
  );
  return file;
}

test("a capped agent gets one report request, then only a fresh agent", () => {
  const data = tmp("dotclaude-data-");
  const transcript = cappedTranscript("a243ca59c15b9edd2");
  const send = (to, message = "keep going", session = "s1") =>
    hook(
      "pre-tool-use/hand-off-capped-agents.mjs",
      {
        session_id: session,
        transcript_path: transcript,
        tool_name: "SendMessage",
        tool_input: { to, summary: "continue", message },
      },
      { CLAUDE_PLUGIN_DATA: data },
    );
  const first = send("a243ca59c15b9edd2").hookSpecificOutput;
  expect(first.permissionDecision).toBe("allow");
  // Only the user sees an allow reason, and Claude Code labels it as a hook's.
  expect(first.permissionDecisionReason).toStartWith("The agent stopped");
  // The message is replaced by one fixed report request, whatever was sent.
  expect(first.updatedInput.message).toBeTruthy();
  expect(first.updatedInput.message).not.toContain("keep going");
  expect(
    send("a243ca59c15b9edd2", "fix the tests", "s2").hookSpecificOutput
      .updatedInput.message,
  ).toBe(first.updatedInput.message);
  expect(first.updatedInput.to).toBe("a243ca59c15b9edd2");
  expect(first.updatedInput.summary).toBe("continue");
  expect(first.additionalContext).toMatch(/^\[dotclaude\] /);
  expect(first.additionalContext).toContain("`a243ca59c15b9edd2`");
  const second = send("a243ca59c15b9edd2").hookSpecificOutput;
  expect(second.permissionDecision).toBe("deny");
  expect(second.permissionDecisionReason).toMatch(/^\[dotclaude\] /);
  expect(second.permissionDecisionReason).toContain("`a243ca59c15b9edd2`");
  // An agent that finished normally can still get follow-ups.
  expect(send("af9c9fd3c3f92e8b3")).toBe(null);
});

test("the turn-limit handoff can be turned off", () => {
  expect(
    hook(
      "pre-tool-use/hand-off-capped-agents.mjs",
      {
        session_id: "s2",
        transcript_path: cappedTranscript("abcd1234"),
        tool_input: { to: "abcd1234", message: "go on" },
      },
      { CLAUDE_PLUGIN_OPTION_USAGE_AGENT_BOUNDS: "false" },
    ),
  ).toBe(null);
});
