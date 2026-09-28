// dotclaude's usage bounds: every copy of a number agrees with _budget.mjs,
// and the text dotclaude adds to every request stays small.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  k,
  MAIN_CONTEXT_TOKENS,
  MAX_CONCURRENT_AGENTS,
  SUBAGENT_CONTEXT_TOKENS,
} from "../../hooks/lib/_budget.mjs";

const root = path.join(import.meta.dir, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the output style, profile, and option text use the budget's numbers", () => {
  expect(read("output-styles/dotclaude.md")).toContain(
    `passes about ${k(MAIN_CONTEXT_TOKENS)} tokens`,
  );
  expect(read("output-styles/dotclaude.md")).toContain(
    `about ${k(SUBAGENT_CONTEXT_TOKENS)} tokens of context`,
  );
  const profile = JSON.parse(
    read("skills/apply-settings-profile/profiles/recommended.json"),
  );
  expect(profile.autoCompactWindow).toBe(MAIN_CONTEXT_TOKENS);
  expect(profile.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe(
    String(MAX_CONCURRENT_AGENTS),
  );
  expect(profile.env.CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS).toBe(
    String(MAX_CONCURRENT_AGENTS),
  );
  expect(read(".claude-plugin/plugin.json")).toContain(
    `passes about ${k(SUBAGENT_CONTEXT_TOKENS)} tokens`,
  );
});

const description = (file) =>
  /^description:\s*(.*)$/m.exec(read(file).split(/^---\s*$/m)[1] ?? "")?.[1]
    ?.length ?? 0;

// Measured 2026-09-28 after 0.7.0's removals: 15,190 + 4,053 + 1,403 bytes. The output style is sent
// with every main request and the descriptions sit in the agent and skill
// listings, so growth here costs every turn of every session.
test("the output style and the agent and skill descriptions stay under 21.5 KB", () => {
  const listed = (dir, pick) =>
    fs
      .readdirSync(path.join(root, dir))
      .map(pick)
      .filter((f) => fs.existsSync(path.join(root, f)));
  const agents = listed("agents", (f) => `agents/${f}`).filter((f) =>
    f.endsWith(".md"),
  );
  const skills = listed("skills", (d) => `skills/${d}/SKILL.md`);
  const total =
    Buffer.byteLength(read("output-styles/dotclaude.md")) +
    [...agents, ...skills].reduce((sum, f) => sum + description(f), 0);
  expect(total).toBeLessThanOrEqual(21_500);
});
