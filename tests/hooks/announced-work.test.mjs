// Announced-work check: a turn whose last paragraph announces the next step
// or asks permission for requested work is sent back once.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { blocked, feedback, hook, session } from "../support/hooks.mjs";

const stop = (message, extra = {}) =>
  hook("stop/finish-announced-work.mjs", {
    session_id: session(),
    hook_event_name: "Stop",
    last_assistant_message: message,
    ...extra,
  });

// Verbatim turn endings from the audited sessions (`sessions-qual.md`).
const ANNOUNCED = [
  "Should I continue building with the safer testing approach, or do you want to look at your settings first?",
  "Nothing is committed yet, and the small README wording fix is still unapplied.",
  "The parser now handles tabs.\n\nNext I'll update the docs and run the linter.",
  "Want me to add the missing test?",
  "I can also fix the second call site if you want.",
];

test("a last paragraph that announces or offers requested work blocks", () => {
  for (const message of ANNOUNCED) {
    const out = stop(`Report line.\n\n${message}`);
    expect(blocked(out), message).toBe("Stop");
    expect(feedback(out)).toContain("do it now, and then report");
  }
});

test("a finished report, a second stop, and public steps pass", () => {
  expect(stop("Fixed the bug. `bun test` passes: 12 pass, 0 fail.")).toBe(null);
  // Only the last paragraph counts.
  expect(stop("Next I'll read the parser.\n\nDone: the parser is fixed.")).toBe(
    null,
  );
  expect(stop(ANNOUNCED[0], { stop_hook_active: true })).toBe(null);
  expect(stop("Should I push the branch and open the pull request?")).toBe(
    null,
  );
  expect(stop("Should I publish 0.12.0 after your sandbox run?")).toBe(null);
  expect(stop("Do you want me to delete the old branch?")).toBe(null);
});

test("a turn that an `AskUserQuestion` or `ExitPlanMode` call ended passes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-ask-"));
  const transcript = path.join(dir, "t.jsonl");
  const entry = (content) =>
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content },
    });
  fs.writeFileSync(
    transcript,
    [
      entry([{ type: "text", text: "Should I use the cache?" }]),
      entry([
        { type: "tool_use", id: "a1", name: "AskUserQuestion", input: {} },
      ]),
    ].join("\n"),
  );
  expect(stop("Should I use the cache?", { transcript_path: transcript })).toBe(
    null,
  );
  fs.writeFileSync(
    transcript,
    entry([{ type: "tool_use", id: "p1", name: "ExitPlanMode", input: {} }]),
  );
  expect(
    stop("Next I'll add the cache.", { transcript_path: transcript }),
  ).toBe(null);
  fs.writeFileSync(transcript, entry([{ type: "text", text: "x" }]));
  expect(
    blocked(stop("Should I use the cache?", { transcript_path: transcript })),
  ).toBe("Stop");
  fs.rmSync(dir, { recursive: true });
});

test("the `gate_verify` option turns the check off", () => {
  const out = hook(
    "stop/finish-announced-work.mjs",
    {
      session_id: session(),
      hook_event_name: "Stop",
      last_assistant_message: ANNOUNCED[3],
    },
    { CLAUDE_PLUGIN_OPTION_GATE_VERIFY: "false" },
  );
  expect(out).toBe(null);
});

test("a headless session or a subagent is told to end with the full report", () => {
  const offer = "Fixed it.\n\nI can add a test if you want.";
  const run = (env, extra) =>
    feedback(
      hook(
        "stop/finish-announced-work.mjs",
        {
          session_id: session(),
          hook_event_name: "Stop",
          last_assistant_message: offer,
          ...extra,
        },
        env,
      ),
    );
  for (const entry of ["sdk-cli", "sdk-ts", "sdk-py"])
    expect(run({ CLAUDE_CODE_ENTRYPOINT: entry })).toContain(
      "only your last message",
    );
  // The added sentence starts on its own line, also after a note that ends
  // with a list or a closing tag.
  expect(
    run({ CLAUDE_CODE_ENTRYPOINT: "cli" }, { hook_event_name: "SubagentStop" }),
  ).toMatch(/\nThe caller gets only your last message/);
  expect(run({ CLAUDE_CODE_ENTRYPOINT: "cli" })).not.toContain(
    "only your last message",
  );
});

const blocks = (message) =>
  blocked(stop(`Report line.\n\n${message}`)) === "Stop";

test("new offer phrases block, and near misses pass", () => {
  for (const message of [
    "The fix is in. If you want, I can also rename it.",
    "The fix is in. Say so and the rename follows.",
    "The fix is in. Say the word and the rename follows.",
    "The fix is in. Renaming it is your call.",
    "The rename is a decision for you.",
    "The fix is in, and so, in the end, should I rename it or leave it as is?",
    "Done with the parser. Shall I go on?",
  ])
    expect(blocks(message), message).toBe(true);
  for (const message of [
    "The fix is in. Your caller passes the id.",
    "The fix is in. It does not say something new.",
    "The fix is in. The docs say the words once.",
    "The fix is in. This is a decision for your team.",
    "The fix is in. I should add this to the notes.",
  ])
    expect(blocks(message), message).toBe(false);
  // Only the last paragraph counts.
  expect(stop("If you want more, ask.\n\nDone: the parser is fixed.")).toBe(
    null,
  );
});

test("new deferral phrases block, and near misses pass", () => {
  for (const message of [
    "The second call site is not fixed.",
    "The second call site is left as a follow-up.",
    "Follow-up: the second call site.",
    "The second call site ships in a later release.",
    "The second call site ships in a later version.",
    "The second call site moves to the next version.",
  ])
    expect(blocks(message), message).toBe(true);
  for (const message of [
    "The second call site is fixed.",
    "The follow-up question was answered.",
    "The next versions of the file match.",
    "The retry is not fixing the call sites.",
  ])
    expect(blocks(message), message).toBe(false);
});

test("only a question about a push, a publish, or a delete is exempt", () => {
  // A release or a tag alone does not exempt a deferral or an offer.
  expect(blocks("The tag step is left as a follow-up for the release.")).toBe(
    true,
  );
  expect(blocks("Next I'll cut the release and tag it.")).toBe(true);
  expect(blocks("Should I tag the release?")).toBe(true);
  // A statement that names a push is not a question.
  expect(blocks("Next I'll push the branch.")).toBe(true);
  expect(blocks("Should I push the branch?")).toBe(false);
  expect(blocks("Shall I publish it, or say the word later?")).toBe(false);
  expect(blocks("Want me to delete the scratch folder?")).toBe(false);
});
