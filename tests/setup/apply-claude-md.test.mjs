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
  expect(run("apply-claude-md.mjs", home, "--source", source)).toContain(
    "First version.",
  );
  expect(fs.readFileSync(file, "utf8")).toBe(
    "## CodeGraph\n\nUser's own rules.\n",
  );
  expect(fs.readdirSync(path.dirname(file))).toStrictEqual(["CLAUDE.md"]);

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

test("the profile writes its tagged rules once, and a second apply changes nothing", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "CLAUDE.md");
  run("apply-claude-md.mjs", home, "--apply");
  const first = fs.readFileSync(file, "utf8");
  // The compaction hook sends the compaction priorities, so the profile has
  // no `# Compact instructions` section.
  expect(first).not.toMatch(/^# Compact instructions$/m);
  const tags = [...first.matchAll(/^<([a-z_]+)>$/gm)].map((m) => m[1]);
  expect(tags).toStrictEqual([
    "installed_tools",
    "git_state",
    "project_commands",
  ]);
  for (const tag of tags) expect(first).toContain(`\n</${tag}>\n`);
  expect(first).not.toMatch(/\{\{/);
  run("apply-claude-md.mjs", home, "--apply");
  expect(fs.readFileSync(file, "utf8")).toBe(first);
});

test("the preview names the lines that the new section drops as removed dotclaude rules", () => {
  const home = tempHome();
  const source = path.join(home, "section.md");
  fs.writeFileSync(source, "Kept rule.\n\n# Compact instructions\n\nOld rule.");
  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  fs.writeFileSync(source, "Kept rule.");
  const out = run("apply-claude-md.mjs", home, "--source", source);
  const dropped = out.slice(out.indexOf("drops these lines"));
  expect(dropped).toContain("# Compact instructions\nOld rule.\n");
  expect(dropped).not.toContain("Kept rule.");
  expect(dropped).toContain("Do not move the markers");
  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  expect(run("apply-claude-md.mjs", home, "--source", source)).not.toContain(
    "drops these lines",
  );
});

test("apply removes an exact retired compact section outside the block and keeps a changed one", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "CLAUDE.md");
  const source = path.join(home, "section.md");
  fs.writeFileSync(source, "Rule.");
  // The layout that a 0.19.0 session left: it moved the end marker above
  // the 0.18.0 section.
  const retired =
    "# Compact instructions\n\n<compaction_priorities>\nWhen you compact the conversation, keep these items:\n\n- the user's requests and constraints, in the user's own words\n- the decisions and the rejected approaches, with their reasons\n- the current state and the open items\n- exact paths, commands, errors, and numbers\n\nThe next turn acts on these details, and a paraphrase loses them.\n</compaction_priorities>\n";
  const block =
    "<!-- dotclaude:begin (managed by /dotclaude:setup; edits inside this block are replaced) -->\nRule.\n<!-- dotclaude:end -->\n";
  fs.writeFileSync(
    file,
    `# CLAUDE.md\n\nMine.\n\n${block}\n${retired}\n## Later\n\nAlso mine.\n`,
  );
  expect(run("apply-claude-md.mjs", home, "--source", source)).toContain(
    "Removes the `# Compact instructions` section",
  );
  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  expect(fs.readFileSync(file, "utf8")).toBe(
    `# CLAUDE.md\n\nMine.\n\n${block}\n## Later\n\nAlso mine.\n`,
  );

  fs.writeFileSync(file, `# CLAUDE.md\n\n${block}\n${retired}`);
  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  expect(fs.readFileSync(file, "utf8")).toBe(`# CLAUDE.md\n\n${block}`);

  const changed = `# CLAUDE.md\n\n${block}\n${retired}- my own item\n`;
  fs.writeFileSync(file, changed);
  expect(run("apply-claude-md.mjs", home, "--source", source)).toContain(
    "nothing to change",
  );
});
