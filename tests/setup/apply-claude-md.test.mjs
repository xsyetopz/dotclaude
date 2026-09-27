// apply-claude-md.mjs, run against a temporary HOME so real settings are never touched.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { run, tempHome } from "../support/setup.mjs";

test("apply-claude-md appends a marked section, replaces it in place, and removes it", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "CLAUDE.md");
  const source = path.join(home, "section.md");
  fs.writeFileSync(file, "## CodeGraph\n\nUser's own rules.\n");
  fs.writeFileSync(source, "First version.");
  expect(run("apply-claude-md.mjs", home, "--source", source)).toMatch(
    /Dry run/,
  );
  expect(fs.readFileSync(file, "utf8")).toBe(
    "## CodeGraph\n\nUser's own rules.\n",
  );

  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  let text = fs.readFileSync(file, "utf8");
  expect(text).toMatch(
    /^# CLAUDE\.md\n\n## CodeGraph\n\nUser's own rules\.\n\n<!-- dotclaude:begin/,
  );
  expect(text).toMatch(/First version\.\n<!-- dotclaude:end -->\n$/);

  fs.writeFileSync(source, "Second version.");
  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  text = fs.readFileSync(file, "utf8");
  expect(text.match(/dotclaude:begin/g).length).toBe(1);
  expect(text).toMatch(/Second version\./);
  expect(text).not.toMatch(/First version/);

  run("apply-claude-md.mjs", home, "--remove", "--apply");
  expect(fs.readFileSync(file, "utf8").trim()).toBe(
    "# CLAUDE.md\n\n## CodeGraph\n\nUser's own rules.",
  );
});

test("apply-claude-md keeps a top-level heading the file already has", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "CLAUDE.md");
  const source = path.join(home, "section.md");
  fs.writeFileSync(file, "# My rules\n\nMine.\n");
  fs.writeFileSync(source, "Notes.");
  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  expect(fs.readFileSync(file, "utf8")).toMatch(
    /^# My rules\n\nMine\.\n\n<!-- dotclaude:begin/,
  );
});
