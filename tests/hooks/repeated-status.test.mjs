// Repeated-status note: the third identical Bash command in a row with
// identical output in one agent adds a note to change the approach or wait
// with `Monitor`.

import { expect, test } from "bun:test";
import { hook, session } from "../support/hooks.mjs";

const bash = (sid, command, stdout, extra = {}) =>
  hook("post-tool-use/note-repeated-status.mjs", {
    session_id: sid,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout, stderr: "" },
    ...extra,
  })?.hookSpecificOutput?.additionalContext ?? null;

test("the third identical command with identical output adds one note", () => {
  const sid = session();
  expect(bash(sid, "gh run view 42", "in_progress")).toBe(null);
  expect(bash(sid, "gh run view 42", "in_progress")).toBe(null);
  const note = bash(sid, "gh run view 42", "in_progress");
  expect(note).toContain("`gh run view 42`");
  expect(note).toContain("`Monitor`");
  // The count starts again after the note.
  expect(bash(sid, "gh run view 42", "in_progress")).toBe(null);
});

test("a changed output, another command, or another agent resets", () => {
  const sid = session();
  bash(sid, "git status", "clean");
  bash(sid, "git status", "clean");
  expect(bash(sid, "git status", "1 file changed"), "changed output").toBe(
    null,
  );
  bash(sid, "git status", "1 file changed");
  bash(sid, "ls", "a");
  expect(bash(sid, "git status", "1 file changed"), "other command").toBe(null);
  bash(sid, "git status", "x", { agent_id: "a1" });
  bash(sid, "git status", "x", { agent_id: "a1" });
  expect(bash(sid, "git status", "x", { agent_id: "a2" }), "agent").toBe(null);
  expect(bash(sid, "git status", "x", { agent_id: "a1" })).toContain(
    "`git status`",
  );
});

test("background commands and the `usage_notes` option pass", () => {
  const sid = session();
  const bg = { tool_input: { command: "sleep 1", run_in_background: true } };
  for (let i = 0; i < 3; i += 1)
    expect(bash(sid, "sleep 1", "", bg)).toBe(null);
  const off = session();
  for (let i = 0; i < 3; i += 1)
    expect(
      hook(
        "post-tool-use/note-repeated-status.mjs",
        {
          session_id: off,
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "date" },
          tool_response: { stdout: "x", stderr: "" },
        },
        { CLAUDE_PLUGIN_OPTION_USAGE_NOTES: "false" },
      ),
    ).toBe(null);
});
