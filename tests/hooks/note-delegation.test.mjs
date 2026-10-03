// The delegation note: the main conversation gets one note per prompt when
// it makes DELEGATION_NOTE_READS read calls with no `Agent` call.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DELEGATION_NOTE_READS } from "../../hooks/lib/_budget.mjs";
import { hook } from "../support/hooks.mjs";

let n = 0;
/** A session with its own state dir, and helpers that call the hooks. */
function session(env = {}) {
  const sessionId = `deleg-${process.pid}-${n++}`;
  const e = {
    CLAUDE_PLUGIN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-d-")),
    ...env,
  };
  const call = (input) =>
    hook(
      "post-tool-use/note-delegation.mjs",
      { session_id: sessionId, hook_event_name: "PostToolUse", ...input },
      e,
    )?.hookSpecificOutput.additionalContext ?? null;
  return {
    read: (extra) =>
      call({ tool_name: "Read", tool_input: { file_path: "/a" }, ...extra }),
    bash: (command) => call({ tool_name: "Bash", tool_input: { command } }),
    agent: () => call({ tool_name: "Agent", tool_input: {} }),
    prompt: (text = "next step") =>
      hook(
        "user-prompt-submit/reset-delegation-count.mjs",
        { session_id: sessionId, prompt: text },
        e,
      ),
  };
}

/** Reads until the count is one short of the bound. */
function nearBound(s, make = () => s.read()) {
  for (let i = 1; i < DELEGATION_NOTE_READS; i++) expect(make()).toBe(null);
}

test("the note comes at the bound and once per prompt", () => {
  const s = session();
  nearBound(s);
  const note = s.read();
  expect(note).toContain(`You made ${DELEGATION_NOTE_READS} read calls`);
  expect(note).toContain("`dotclaude:investigator`");
  expect(note).toContain("`dotclaude:implementer`");
  expect(s.read(), "once per prompt").toBe(null);
  expect(s.read()).toBe(null);
});

test("Bash reads count, and other Bash commands do not", () => {
  const s = session();
  const reads = [
    "sed -n 1,20p a.txt",
    "rg -n foo src",
    "git log --oneline",
    "python3 - <<'EOF'\nprint(1)\nEOF",
    "cat a.txt | head",
    "ls -la",
  ];
  for (const c of reads) expect(s.bash(c)).toBe(null);
  for (const c of [
    "cat > a.txt <<'EOF'\nx\nEOF",
    "sed -i s/a/b/ f",
    "git commit -m x",
    "bun test",
  ])
    for (let i = 0; i < DELEGATION_NOTE_READS; i++)
      expect(s.bash(c)).toBe(null);
  // Only the 6 reads counted, so 6 more reach the bound.
  for (let i = reads.length + 1; i < DELEGATION_NOTE_READS; i++)
    expect(s.bash("rg x")).toBe(null);
  expect(s.bash("rg x")).toContain("read calls");
});

test("an Agent call resets the count", () => {
  const s = session();
  nearBound(s);
  expect(s.agent()).toBe(null);
  nearBound(s);
  expect(s.read()).toContain("read calls");
});

test("a typed prompt resets the count, and a task notification does not", () => {
  const s = session();
  nearBound(s);
  s.prompt("<task-notification>\n<task-id>x</task-id>\n</task-notification>");
  expect(s.read(), "a task notification clears nothing").toContain(
    "read calls",
  );
  const t = session();
  nearBound(t);
  t.prompt();
  nearBound(t);
  expect(t.read()).toContain("read calls");
});

test("a subagent's calls and a session with usage_notes off get no note", () => {
  const s = session();
  for (let i = 0; i < DELEGATION_NOTE_READS + 2; i++)
    expect(s.read({ agent_id: "a1" })).toBe(null);
  // The subagent's calls did not count.
  nearBound(s);
  const off = session({ CLAUDE_PLUGIN_OPTION_USAGE_NOTES: "false" });
  for (let i = 0; i < DELEGATION_NOTE_READS + 2; i++)
    expect(off.read()).toBe(null);
});
