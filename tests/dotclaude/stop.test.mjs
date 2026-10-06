// The Stop hook blocks a plain-text question to the user.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  asksInPlainText,
  decisionFor,
  REASON,
} from "../../plugins/dotclaude/hooks/stop/block-plain-questions.mjs";

const SCRIPT = path.join(
  import.meta.dir,
  "../../plugins/dotclaude/hooks/stop/block-plain-questions.mjs",
);

test("a question in the last 3 prose lines is found", () => {
  for (const text of [
    "Done.\nShould I also update the wiki?",
    "Which one do you want?\n\nA or B.",
    "Proceed with the bump?**",
    'Is that right?"',
  ])
    expect(asksInPlainText(text)).toBe(true);
});

test("code, headings, quotes, and older lines are not a question", () => {
  for (const text of [
    "Done.",
    "Run this:\n```js\nconst ok = a ?\nb : c?\n```",
    "The flag is `--dry-run?`.",
    "## Why?\nIt is fixed.",
    "> Is this the bug?\nIt was.",
    "Is it fixed?\nYes.\nTests pass.\nThe wiki is updated.",
    "",
    undefined,
  ])
    expect(asksInPlainText(text)).toBe(false);
});

test("the hook blocks once, and not when stop_hook_active is set", () => {
  const data = { last_assistant_message: "Should I commit?" };
  expect(decisionFor(data)).toEqual({ decision: "block", reason: REASON });
  expect(decisionFor({ ...data, stop_hook_active: true })).toBeUndefined();
  expect(decisionFor({ last_assistant_message: "Done." })).toBeUndefined();
  expect(decisionFor(null)).toBeUndefined();
});

test("the reason names AskUserQuestion and clause 16, with no semicolons", () => {
  expect(REASON).toContain("`AskUserQuestion`");
  expect(REASON).toContain("clause 16");
  expect(REASON).not.toContain(";");
});

test("the script prints the block for a question and nothing otherwise", () => {
  const run = (input) =>
    spawnSync("bun", [SCRIPT], { input, encoding: "utf8" }).stdout;
  expect(
    JSON.parse(run(JSON.stringify({ last_assistant_message: "Ship it?" }))),
  ).toEqual({ decision: "block", reason: REASON });
  expect(run(JSON.stringify({ last_assistant_message: "Done." }))).toBe("");
  expect(run("not json")).toBe("");
});
