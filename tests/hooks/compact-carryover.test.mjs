// Compaction carry-over of prompts and the last check.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  checkRun,
  data,
  edit,
  hook,
  repo,
  session,
} from "../support/hooks.mjs";

test("compaction carry-over restores prompts and last check", () => {
  const sid = session();
  const transcript = path.join(data, `${sid}.jsonl`);
  const lines = [
    {
      type: "user",
      origin: { kind: "human" },
      message: { content: "Add retry to the fetch client" },
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", content: "ok" }] },
    },
    // Claude Code stores the compaction summary as a user entry.
    {
      type: "user",
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: {
        content:
          "This session is being continued from a previous conversation that ran out of context.",
      },
    },
    {
      type: "user",
      isMeta: true,
      message: { content: "<system-reminder>x</system-reminder>" },
    },
    {
      type: "attachment",
      attachment: {
        type: "queued_command",
        humanTurn: true,
        prompt: "Keep the public API unchanged",
      },
    },
    {
      type: "user",
      origin: { kind: "task-notification" },
      message: { content: "<task-notification>done</task-notification>" },
    },
  ];
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join("\n"));
  checkRun(sid, "bun test");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "mine.js"), "x\n");
  fs.writeFileSync(path.join(repo, "src", "users.js"), "y\n");
  edit(sid, "src/mine.js");
  checkRun(sid, "bun test");
  hook("pre-compact/save-recent-prompts.mjs", {
    session_id: sid,
    hook_event_name: "PreCompact",
    transcript_path: transcript,
  });
  const out = hook("session-start/restore-context-after-compact.mjs", {
    session_id: sid,
    hook_event_name: "SessionStart",
    source: "compact",
    transcript_path: transcript,
  });
  const text = out.hookSpecificOutput.additionalContext;
  expect(text).toMatch(
    /1\. Add retry to the fetch client\n2\. Keep the public API unchanged/,
  );
  expect(text).not.toMatch(/task-notification|system-reminder|being continued/);
  expect(text).toMatch(/`bun test` passed/);
  // Each file list is its own paragraph: first the files this session
  // edited, then the files it did not record as edited.
  const paragraphs = text.split("\n\n");
  const ours = paragraphs.findIndex((p) => p.includes("src/mine.js"));
  const theirs = paragraphs.findIndex((p) => p.includes("src/users.js"));
  expect(ours).toBeGreaterThan(-1);
  expect(theirs).toBeGreaterThan(ours);
  expect(paragraphs.filter((p) => p.includes("src/mine.js"))).toHaveLength(1);
  expect(paragraphs.filter((p) => p.includes("src/users.js"))).toHaveLength(1);
  expect(text.length <= 2600).toBeTruthy();
});

// Custom output styles get no per-turn reminder (#88189), so the report rule
// comes back once after each compaction, even with no other state to restore.
test("compaction restates the report rule once, and only after compaction", () => {
  const sid = session();
  const input = (source) => ({
    session_id: sid,
    hook_event_name: "SessionStart",
    source,
    transcript_path: path.join(data, `${sid}-none.jsonl`),
  });
  const after = hook("session-start/restore-context-after-compact.mjs", {
    ...input("compact"),
  });
  const text = after.hookSpecificOutput.additionalContext;
  expect(text).toMatch(/start with the outcome/);
  expect(text.match(/start with the outcome/g)).toHaveLength(1);
  for (const source of ["startup", "resume", "clear"])
    expect(
      hook("session-start/restore-context-after-compact.mjs", input(source)),
    ).toBeNull();
});

// Compaction hooks also fire for subagents, sometimes with no agent fields
// (#91910). A subagent compaction must not replace the main session's prompts
// or add context to the subagent.
test("a subagent compaction keeps the main session's prompts", () => {
  const sid = session();
  const write = (file, prompt) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: "user",
        origin: { kind: "human" },
        message: { content: prompt },
      }),
    );
  };
  const main = path.join(data, `${sid}.jsonl`);
  const sub = path.join(data, sid, "subagents", "agent-x.jsonl");
  write(main, "Fix the login form");
  write(sub, "Find the form handler");
  const compact = (transcript, extra = {}) =>
    hook("pre-compact/save-recent-prompts.mjs", {
      session_id: sid,
      hook_event_name: "PreCompact",
      transcript_path: transcript,
      ...extra,
    });
  compact(main);
  compact(sub);
  compact(sub, { agent_id: "x", agent_type: "dotclaude:implementer" });
  const restore = (transcript, extra = {}) =>
    hook("session-start/restore-context-after-compact.mjs", {
      session_id: sid,
      hook_event_name: "SessionStart",
      source: "compact",
      transcript_path: transcript,
      ...extra,
    });
  const text = restore(main).hookSpecificOutput.additionalContext;
  expect(text).toMatch(/1\. Fix the login form/);
  expect(text).not.toMatch(/form handler/);
  expect(restore(sub)).toBeNull();
  expect(restore(sub, { agent_id: "x" })).toBeNull();
});
