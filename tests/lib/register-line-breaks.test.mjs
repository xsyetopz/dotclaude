// The line-break check after an edit, through the hooks module. The fake
// engine has no `semlf`, so the built-in check runs.

import { expect, test } from "bun:test";
import { fake, registered } from "./fake-engine.mjs";

const wrapped =
  "# Notes\n\nThe hook reads the file that the edit wrote and then it compares the\nlines with the rules of the project.\n";

const write = (on, $, file, content) =>
  on["tool.call"](
    $,
    { tool: "Write", tool_use_id: "t1", file_path: file, content },
    async () => ({ result: "ok" }),
  );

test("a column wrap that Claude writes gets a note", async () => {
  const r = await write(
    registered({ context_line_breaks: true }),
    fake(),
    "/work/docs/a.md",
    wrapped,
  );
  const note = r.context.join("\n");
  expect(note).toStartWith(
    "[dotclaude] <line_break_findings>\n- The line stops in a clause:",
  );
  expect(note).toContain("The line stops in a clause: `the` | `lines`.");
  expect(note).toContain("The text that you wrote in `/work/docs/a.md`");
});

test("semantic line breaks get no note", async () => {
  const text =
    "# Notes\n\nThe hook reads the file that the edit wrote.\nThen it compares the lines with the rules of the project.\n";
  const r = await write(
    registered({ context_line_breaks: true }),
    fake(),
    "/work/docs/a.md",
    text,
  );
  expect(r).toEqual({ result: "ok" });
});

test("the check is off by default and with context_line_breaks false", async () => {
  for (const options of [{}, { context_line_breaks: false }]) {
    const r = await write(
      registered(options),
      fake(),
      "/work/docs/a.md",
      wrapped,
    );
    expect(r).toEqual({ result: "ok" });
  }
});
