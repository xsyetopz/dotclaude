// The four output styles. Each one holds only its reply-style rules, because
// the working rules come from a SessionStart hook with every style. The
// tags that a style names must exist in the working rules.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..", "..");
const dir = path.join(root, "output-styles");
const NAMES = ["Proactive", "Concise", "Explanatory", "Learning"];
const read = (name) =>
  fs.readFileSync(path.join(dir, `${name.toLowerCase()}.md`), "utf8");
const front = (text) => /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
const body = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "");
const rules = fs.readFileSync(
  path.join(root, "hooks", "session-start", "working-rules.md"),
  "utf8",
);

test("each style file has its name, a description, and the coding instructions", () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  expect(files.sort()).toEqual(
    NAMES.map((n) => `${n.toLowerCase()}.md`).sort(),
  );
  for (const name of NAMES) {
    const meta = front(read(name));
    expect(meta, name).toContain(`name: ${name}\n`);
    // A literal description says what the style does, with no "Name:"
    // label in front.
    expect(meta, name).toMatch(/^description: "[A-Z][a-z]+s [^:]+"$/m);
    expect(meta, name).toContain("keep-coding-instructions: true");
    // A forced style overrides the user's `outputStyle`, so setup could not
    // select a variant.
    expect(meta, name).not.toContain("force-for-plugin");
  }
});

test("each style holds only its blocks, and names only tags of the working rules", () => {
  for (const name of NAMES) {
    const text = body(read(name)).trim();
    expect(text.startsWith("<"), name).toBe(true);
    expect(text, name).not.toContain("<harness>");
    for (const [, tag] of text.matchAll(/`<(\w+)>`/g))
      expect(rules, `${name}: <${tag}>`).toContain(`<${tag}>`);
  }
});
