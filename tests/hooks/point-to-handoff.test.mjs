// A new session hears about an open handoff note, and not about a done one.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hook } from "../support/hooks.mjs";

const NAME = "2026-09-30-1200-retries.md";

// `notes` is one note's text, or an object of file name -> text.
function start(notes, source = "clear", env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-handoff-"));
  if (notes !== undefined) {
    const folder = path.join(dir, ".claude", "handoffs");
    fs.mkdirSync(folder, { recursive: true });
    const files = typeof notes === "string" ? { [NAME]: notes } : notes;
    for (const [name, text] of Object.entries(files))
      fs.writeFileSync(path.join(folder, name), text);
  }
  const out = hook(
    "session-start/point-to-handoff.mjs",
    { cwd: dir, hook_event_name: "SessionStart", source },
    { CLAUDE_PROJECT_DIR: dir, ...env },
  );
  return out?.hookSpecificOutput?.additionalContext;
}

const note = (status) =>
  `---\nstatus: ${status} # or blocked, or done\nbranch: main\nhead: abc1234\nwritten: 2026-09-30T12:00Z\n---\n\n## Goal\n`;

test("an open handoff note is pointed out with its front matter", () => {
  const ctx = start(note("in-progress"));
  expect(ctx).toContain(`\`.claude/handoffs/${NAME}\``);
  expect(ctx).toContain("status `in-progress`");
  expect(ctx).toContain("`abc1234`");
  expect(ctx).toContain("git status");
  expect(start(note("blocked"), "startup")).toContain("status `blocked`");
  expect(start("## Goal\nno front matter\n")).toContain(
    `\`.claude/handoffs/${NAME}\``,
  );
});

test("the newest open note is named, and closed notes are skipped", () => {
  const ctx = start({
    "2026-09-28-0800-auth.md": note("blocked"),
    "2026-09-29-0800-retries.md": note("in-progress"),
    "2026-09-30-0800-retries.md": note("superseded"),
    "2026-10-01-0800-docs.md": note("done"),
    "readme.txt": "not a note",
  });
  expect(ctx).toContain("`.claude/handoffs/2026-09-29-0800-retries.md`");
  expect(ctx).toContain("1 older open note is also in `.claude/handoffs/`");
});

test("a closed note, no note, or the option off adds nothing", () => {
  expect(start(note("done"))).toBeUndefined();
  expect(start(note("superseded"))).toBeUndefined();
  expect(start({})).toBeUndefined();
  expect(start(undefined)).toBeUndefined();
  expect(
    start(note("in-progress"), "clear", {
      CLAUDE_PLUGIN_OPTION_CONTEXT_HANDOFF_POINTER: "false",
    }),
  ).toBeUndefined();
});

test("resume and compact do not repeat the pointer", () => {
  expect(start(note("in-progress"), "resume")).toBeUndefined();
  expect(start(note("in-progress"), "compact")).toBeUndefined();
});
