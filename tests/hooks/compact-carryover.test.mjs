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
  expect(text).not.toMatch(/task-notification|system-reminder/);
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
