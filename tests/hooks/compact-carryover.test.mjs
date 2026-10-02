// Compaction carry-over of prompts and the last check.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  checkRun,
  data,
  edit,
  hook,
  repo,
  session,
  tmp,
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

// Long prompts fill the budget. The newest message holds the current
// request, so it stays whole, also past the old 600-character save cut.
// The oldest messages drop first, a cut message keeps its start and its
// end, and a pointer names the transcript that has the full text. The
// closing tag and the instructions after the prompts stay.
test("the budget cut keeps the newest prompt whole and drops the oldest", () => {
  const sid = session();
  const transcript = path.join(data, `${sid}-long.jsonl`);
  // The transcript path is in the note, so the room for the older prompts
  // changes with the temp folder. Each older prompt is longer than that room
  // for every temp folder, so the cut does not depend on the platform.
  const prompts = [1, 2, 3, 4, 5].map(
    (n) => `Prompt ${n} ${"word ".repeat(n === 5 ? 180 : 250)}END ${n}`,
  );
  fs.writeFileSync(
    transcript,
    prompts
      .map((p) =>
        JSON.stringify({
          type: "user",
          origin: { kind: "human" },
          message: { content: p },
        }),
      )
      .join("\n"),
  );
  const root = tmp("dotclaude-repo-");
  execFileSync("git", ["init", "-q", root]);
  fs.writeFileSync(path.join(root, "users.js"), "y\n");
  hook("pre-compact/save-recent-prompts.mjs", {
    session_id: sid,
    hook_event_name: "PreCompact",
    transcript_path: transcript,
  });
  const text = hook(
    "session-start/restore-context-after-compact.mjs",
    {
      session_id: sid,
      hook_event_name: "SessionStart",
      source: "compact",
      transcript_path: transcript,
      cwd: root,
    },
    { CLAUDE_PROJECT_DIR: root },
  ).hookSpecificOutput.additionalContext;
  expect(text).toContain(`5. ${prompts[4]}\n</recent_user_messages>`);
  expect(text).not.toMatch(/^1\. Prompt 1/m);
  expect(text).toMatch(
    /^\d\. Prompt \d word[^\n]* \[\.\.\.\] [^\n]*word END \d$/m,
  );
  expect(text).toContain(`\`${transcript}\``);
  expect(text).toMatch(/<other_changes>\nusers\.js\n<\/other_changes>/);
  expect(text).toMatch(/the user changed it\.\nKeep these changes/);
  expect(text.endsWith("do not say that they are yours.")).toBeTruthy();
  expect(text.length <= 2600).toBeTruthy();
});

// Long file lists have their own bound, so they cannot push the newest
// prompt, the instructions, or the last check out of the note.
test("long file lists keep the newest prompt and the instructions", () => {
  const sid = session();
  const transcript = path.join(data, `${sid}-lists.jsonl`);
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      type: "user",
      origin: { kind: "human" },
      message: { content: `Rename ${"the billing modules ".repeat(80)}END` },
    }),
  );
  const root = tmp("dotclaude-repo-");
  execFileSync("git", ["init", "-q", root]);
  const dir = path.join(root, "src", "services", "billing", "adapters");
  fs.mkdirSync(dir, { recursive: true });
  for (let n = 0; n < 40; n += 1) {
    const name = `invoice-reconciliation-adapter-${n}.js`;
    fs.writeFileSync(path.join(dir, name), "x\n");
    if (n < 20) edit(sid, `src/services/billing/adapters/${name}`);
  }
  checkRun(sid, `bun test ${"tests/billing/adapters.test.mjs ".repeat(20)}`);
  hook("pre-compact/save-recent-prompts.mjs", {
    session_id: sid,
    hook_event_name: "PreCompact",
    transcript_path: transcript,
  });
  const text = hook(
    "session-start/restore-context-after-compact.mjs",
    {
      session_id: sid,
      hook_event_name: "SessionStart",
      source: "compact",
      transcript_path: transcript,
      cwd: root,
    },
    { CLAUDE_PROJECT_DIR: root },
  ).hookSpecificOutput.additionalContext;
  const quoted = text.match(/^1\. Rename .* \[\.\.\.\] .*END$/m)?.[0] ?? "";
  expect(quoted.length).toBeGreaterThanOrEqual(200);
  expect(text).toMatch(/, and \d+ more\.\n/);
  expect(text).toMatch(/, and \d+ more\n<\/other_changes>/);
  expect(text).toMatch(/the user changed it\.\nKeep these changes/);
  expect(text).toMatch(/`bun test [^`]*…` passed\.$/);
  expect(text.length <= 2600).toBeTruthy();
});

// The working rules come again from their own hook, so with no state to
// restore the carry-over adds nothing, and it runs only after compaction.
test("the carry-over adds nothing without state, and only after compaction", () => {
  const sid = session();
  const input = (source) => ({
    session_id: sid,
    hook_event_name: "SessionStart",
    source,
    transcript_path: path.join(data, `${sid}-none.jsonl`),
  });
  // An empty repository, so no uncommitted file is state.
  const clean = tmp("dotclaude-repo-");
  execFileSync("git", ["init", "-q", clean]);
  for (const source of ["compact", "startup", "resume", "clear"])
    expect(
      hook(
        "session-start/restore-context-after-compact.mjs",
        { ...input(source), cwd: clean },
        { CLAUDE_PROJECT_DIR: clean },
      ),
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
