import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const read = (name) =>
  readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");

test.each(["handoff", "contribute", "setup"])(
  "%s has a skill header",
  (name) => {
    const text = read(name);
    expect(text).toMatch(
      new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n`),
    );
    expect(text.split("\n").length).toBeLessThanOrEqual(300);
  },
);

test("handoff keeps its sections and status front matter", () => {
  const text = read("handoff");
  for (const word of ["Goal", "State", "Decisions", "Open", "Details"])
    expect(text).toContain(`**${word}`);
  expect(text).toContain("status: in-progress");
});

test("setup ships one profile", () => {
  const dir = new URL("../skills/setup/profiles/", import.meta.url);
  expect(existsSync(new URL("recommended.json", dir))).toBe(true);
  expect(existsSync(new URL("optional.json", dir))).toBe(false);
});

test("plugin manifest keeps only the guard, CodeGraph, handoff, and sembr options", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url)),
  );
  expect(Object.keys(manifest.userConfig)).toEqual([
    "guard_bash",
    "guard_edit",
    "guard_secrets",
    "guard_agents",
    "codegraph",
    "ponytail",
    "compaction_handoff",
    "sembr",
  ]);
});
