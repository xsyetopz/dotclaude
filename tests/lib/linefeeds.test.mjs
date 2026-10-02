// The line-break checks of `_linefeeds.mjs`, and the `semlf` report with a
// fake `io.run`.

import { expect, test } from "bun:test";
import {
  findingsNote,
  lineBreakFindings,
  semlfReport,
  skipped,
  writtenTexts,
} from "../../hooks/lib/_linefeeds.mjs";

const kinds = (file, text, opts) =>
  lineBreakFindings(file, text, opts).map((f) => f.kind);

test("a word split over two comment lines is found", () => {
  const js = "/**\n * Reads the configur\n *ation once.\n */\n";
  expect(lineBreakFindings("a.js", js)).toEqual([
    { kind: "split", quote: "`configur` | `ation`" },
  ]);
  expect(kinds("a.js", "// The configur\n//ation is read.\n")).toEqual([
    "split",
  ]);
  expect(kinds("a.py", "# The configur\n#ation is read.\n")).toEqual(["split"]);
  // The split check runs also when `semlf` checks the wraps.
  expect(kinds("a.js", js, { wraps: false })).toEqual(["split"]);
});

test("a comment continuation with a space or a capital is not a split", () => {
  expect(kinds("a.js", "// The configuration\n// is read once.\n")).toEqual([]);
  expect(kinds("a.js", "// First sentence\n//Second sentence.\n")).toEqual([]);
  // `#` is not a comment in JavaScript.
  expect(kinds("a.js", "  #count\n  #total = 0;\n")).toEqual([]);
  expect(kinds("a.md", "The configur\nation is read.\n")).toEqual([]);
});

test("a long prose line that stops in a clause is a wrap", () => {
  const md =
    "The hook reads the file that the edit wrote and then it compares the\nlines with the rules of the project.\n";
  expect(lineBreakFindings("doc.md", md)).toEqual([
    { kind: "wrap", quote: "`the` | `lines`" },
  ]);
  const js =
    "// The hook reads the file that the edit wrote and then it compares the\n// lines with the rules of the project.\n";
  expect(kinds("a.js", js)).toEqual(["wrap"]);
  expect(kinds("doc.md", md, { wraps: false })).toEqual([]);
});

test("semantic breaks are not wraps", () => {
  const md = [
    "The hook reads the file that the edit wrote, and it compares the lines.",
    "Each sentence starts on a new line.",
    "The hook reads the file that the edit wrote and compares the lines",
    "because a column wrap goes on into later text.",
    "Short line",
    "continues here.",
    "",
    "- A list item that is long enough to pass the column bound of the check",
    "- another item",
    "",
    "```",
    "const value = computeTheValueOfTheThingThatTheCheckMustNotLookAtHere",
    "something();",
    "```",
  ].join("\n");
  expect(kinds("doc.md", md)).toEqual([]);
  const front =
    "---\ndescription: A long description of a skill that the check must not read as prose\nname: x\n---\n";
  expect(kinds("SKILL.md", front)).toEqual([]);
  const tag =
    "/**\n * Reads the file that the edit wrote and compares the lines with them\n * @param io the io\n */\n";
  expect(kinds("a.js", tag)).toEqual([]);
});

test("the written texts come from each edit tool", () => {
  expect(writtenTexts({ content: "a" })).toEqual(["a"]);
  expect(writtenTexts({ old_string: "x", new_string: "b" })).toEqual(["b"]);
  expect(
    writtenTexts({ edits: [{ new_string: "c" }, { new_string: "" }, {}] }),
  ).toEqual(["c"]);
  expect(writtenTexts({ new_source: "d" })).toEqual(["d"]);
  expect(writtenTexts({})).toEqual([]);
});

test("generated, vendored, and temp paths are skipped", () => {
  expect(skipped("/p/node_modules/x/a.md", "/t")).toBe(true);
  expect(skipped("/p/tests/fixtures/a.md", "/t")).toBe(true);
  expect(skipped("C:\\p\\dist\\a.md", "/t")).toBe(true);
  expect(skipped("/t/a.md", "/t")).toBe(true);
  expect(skipped("/p/docs/a.md", "/t")).toBe(false);
  expect(skipped("/p/distance.md", "/t")).toBe(false);
});

test("the note names the file and each finding, with a bound", () => {
  const findings = Array.from({ length: 7 }, () => ({
    kind: "wrap",
    quote: "`a` | `b`",
  }));
  const note = findingsNote("/p/a.md", [
    { kind: "split", quote: "`x` | `y`" },
    ...findings,
  ]);
  expect(note).toContain("`/p/a.md`");
  expect(note).toContain("A word is split between two lines: `x` | `y`.");
  expect(note.match(/stops in a clause/g)).toHaveLength(4);
  expect(note).toContain("- 3 more of the same.");
});

const runner = (result) => ({
  cwd: "/p",
  tmp: "/t",
  calls: [],
  async run(argv, init) {
    this.calls.push({ argv, init });
    if (result instanceof Error) throw result;
    return { stdout: "", stderr: "", ...result };
  },
});

test("semlf gives its blocking report from stderr and its advice from stdout", async () => {
  const blocked = runner({ exitCode: 2, stderr: "[fused] line 3\n" });
  const data = { tool_name: "Write", tool_input: { file_path: "/p/a.md" } };
  expect(await semlfReport(blocked, data)).toBe("[fused] line 3");
  expect(blocked.calls[0].argv).toEqual(["semlf", "--hook", "claude"]);
  expect(JSON.parse(blocked.calls[0].init.stdin)).toEqual(data);
  const advice = JSON.stringify({
    hookSpecificOutput: { additionalContext: "[long] line 3" },
  });
  expect(await semlfReport(runner({ exitCode: 0, stdout: advice }), {})).toBe(
    "[long] line 3",
  );
  expect(await semlfReport(runner({ exitCode: 0 }), {})).toBe("");
});

test("a missing or failing semlf gives null", async () => {
  expect(await semlfReport(runner(new Error("ENOENT")), {})).toBeNull();
  expect(await semlfReport(runner({ exitCode: 64 }), {})).toBeNull();
});
