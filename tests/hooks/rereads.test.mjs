// Re-read guard: a full read of a file that did not change since the same
// agent's last full read is denied. Claude Code dedupes `Read` itself, so the
// gap is `cat`, and a `Read` after a `cat` or the reverse.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { hook, repo, session } from "../support/hooks.mjs";

const file = path.join(repo, "notes.txt");
fs.writeFileSync(file, "one\n");

const pre = (sid, tool_name, tool_input, agent_id) =>
  hook("pre-tool-use/skip-unchanged-rereads.mjs", {
    session_id: sid,
    agent_id,
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input,
  })?.hookSpecificOutput ?? null;
const post = (sid, tool_name, tool_input, agent_id) =>
  hook("post-tool-use/record-edits-and-checks.mjs", {
    session_id: sid,
    agent_id,
    hook_event_name: "PostToolUse",
    tool_name,
    tool_input,
    tool_response: { stdout: "one\n", stderr: "" },
  });
const read = (sid, tool, agent) => {
  const input =
    tool === "Read" ? { file_path: file } : { command: "cat notes.txt" };
  const out = pre(sid, tool, input, agent);
  if (!out) post(sid, tool, input, agent);
  return out?.permissionDecision ?? null;
};

test("an unchanged full re-read is denied and names the earlier read", () => {
  const sid = session();
  expect(read(sid, "Bash")).toBe(null);
  const out = pre(sid, "Bash", { command: "cat notes.txt" });
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toContain("`cat notes.txt`");
  expect(out.permissionDecisionReason).toContain("offset");
  expect(read(sid, "Read"), "Read after cat").toBe("deny");
  const sid2 = session();
  expect(read(sid2, "Read")).toBe(null);
  expect(read(sid2, "Bash"), "cat after Read").toBe("deny");
});

test("partial reads, changed files, other agents, and compaction pass", () => {
  const sid = session();
  expect(read(sid, "Bash")).toBe(null);
  expect(
    pre(sid, "Read", { file_path: file, offset: 1, limit: 5 }),
    "a partial Read",
  ).toBe(null);
  expect(pre(sid, "Bash", { command: "cat notes.txt | head -3" })).toBe(null);
  expect(read(sid, "Bash", "agent-1"), "another agent").toBe(null);
  fs.writeFileSync(file, "one\ntwo\n");
  expect(read(sid, "Bash"), "the file changed").toBe(null);
  expect(read(sid, "Bash")).toBe("deny");
  hook("pre-compact/save-recent-prompts.mjs", {
    session_id: sid,
    hook_event_name: "PreCompact",
  });
  expect(read(sid, "Bash"), "after compaction").toBe(null);
});
