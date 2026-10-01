// PostToolUseFailure(Edit): when `old_string` does not match, Claude gets the
// closest lines of the file with their line numbers.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hook } from "../support/hooks.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-edit-miss-"));
const file = path.join(dir, "client.js");
fs.writeFileSync(
  file,
  [
    "import { get } from './http.js';",
    "",
    "export async function fetchUser(id) {",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: file content for the fixture, not a template.
    "  const res = await get(`/users/${id}`);",
    "  if (!res.ok) throw new Error('fetch failed');",
    "  return res.json();",
    "}",
    "",
    "export const VERSION = 2;",
  ].join("\n"),
);

const MISS = "String to replace not found in file.\nString: x";

const failure = (old_string, error = MISS, tool_name = "Edit") =>
  hook("post-tool-use-failure/show-closest-lines.mjs", {
    hook_event_name: "PostToolUseFailure",
    tool_name,
    tool_input: { file_path: file, old_string, new_string: "y" },
    error,
  })?.hookSpecificOutput?.additionalContext ?? null;

test("a missed old_string gets the closest lines with line numbers", () => {
  const text = failure(
    '  if (!res.ok) throw new Error("fetch failed");\n  return res.json()',
  );
  expect(text).toMatch(/lines 5-6/);
  expect(text).toContain("5\t  if (!res.ok) throw new Error('fetch failed');");
  expect(text).toContain("6\t  return res.json();");
  expect(text).not.toContain("VERSION");
});

test("a whitespace-only difference finds the line", () => {
  const text = failure("export   async function fetchUser(id) {");
  expect(text).toContain("3\texport async function fetchUser(id) {");
});

test("no output when nothing is close, or for other failures", () => {
  expect(failure("class Totally { different() {} }")).toBe(null);
  expect(failure("const res", "Found 2 matches of the string")).toBe(null);
  expect(failure("const res", MISS, "Bash")).toBe(null);
  expect(
    hook("post-tool-use-failure/show-closest-lines.mjs", {
      tool_name: "Edit",
      tool_input: { file_path: path.join(dir, "gone.js"), old_string: "x" },
      error: MISS,
    }),
  ).toBe(null);
});
