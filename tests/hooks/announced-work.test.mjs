// Announced-work check: a turn whose last paragraph announces the next step
// or asks permission for requested work is sent back once.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hook, session } from "../support/hooks.mjs";

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
    expect(out?.decision, message).toBe("block");
    expect(out.reason).toContain("do that work now");
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
  expect(stop("Next I'll publish 0.12.0 after your sandbox run.")).toBe(null);
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
    stop("Should I use the cache?", { transcript_path: transcript })?.decision,
  ).toBe("block");
  fs.rmSync(dir, { recursive: true });
});

test("the `stop_gate` option turns the check off", () => {
  const out = hook(
    "stop/finish-announced-work.mjs",
    {
      session_id: session(),
      hook_event_name: "Stop",
      last_assistant_message: ANNOUNCED[3],
    },
    { CLAUDE_PLUGIN_OPTION_STOP_GATE: "false" },
  );
  expect(out).toBe(null);
});
