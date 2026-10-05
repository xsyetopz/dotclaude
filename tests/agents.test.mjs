import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { SUBAGENT_EFFORTS } from "../hooks/lib/_budget.mjs";

const DIR = new URL("../agents/", import.meta.url);
const EXPECTED = [
  "debugger",
  "implementer",
  "investigator",
  "reverse-engineer",
  "reviewer",
  "test-runner",
  "web-researcher",
];

// Reads the `key: value` lines between the first two `---` lines.
function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("no frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2];
  }
  return fields;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
const agents = Object.fromEntries(
  files.map((f) => [
    f.replace(/\.md$/, ""),
    frontmatter(readFileSync(new URL(f, DIR), "utf8")),
  ]),
);

test("exactly the expected agents exist", () => {
  expect(Object.keys(agents).sort()).toEqual(EXPECTED);
});

test("each agent name matches its file name", () => {
  for (const [file, fm] of Object.entries(agents)) expect(fm.name).toBe(file);
});

test("each agent sets maxTurns as a positive integer", () => {
  for (const fm of Object.values(agents)) {
    expect(fm.maxTurns).toMatch(/^[1-9]\d*$/);
  }
});

test("model and effort follow the family rules", () => {
  for (const [name, fm] of Object.entries(agents)) {
    const efforts = SUBAGENT_EFFORTS[fm.model?.replace(/^claude-/, "")];
    expect(efforts, `${name} model`).toBeDefined();
    if (efforts.length === 0) {
      expect("effort" in fm, `${name} effort`).toBe(false);
      expect("thinking" in fm, `${name} thinking`).toBe(false);
    } else {
      expect(efforts, `${name} effort`).toContain(fm.effort);
    }
  }
});

test("the effort table holds", () => {
  const table = {
    "reverse-engineer": ["claude-opus-5-5", "high"],
    reviewer: ["claude-sonnet-5-5", "medium"],
    debugger: ["claude-sonnet-5-5", "medium"],
    implementer: ["claude-sonnet-5-5", "medium"],
    investigator: ["claude-sonnet-5-5", "medium"],
    "web-researcher": ["claude-sonnet-5-5", "medium"],
  };
  for (const [name, [model, effort]] of Object.entries(table)) {
    expect([agents[name].model, agents[name].effort]).toEqual([model, effort]);
  }
  expect(agents["test-runner"].model).toBe("claude-haiku-4-5");
});
