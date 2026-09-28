// dotclaude's usage bounds: every copy of a number agrees with _budget.mjs,
// and the text dotclaude adds to requests stays inside LIMITS. A warn prints
// and a fail fails the test.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  k,
  LIMITS,
  lineCount,
  MAIN_CONTEXT_TOKENS,
  MAX_CONCURRENT_AGENTS,
  STALE_CACHE_CONTEXT_TOKENS,
  SUBAGENT_CONTEXT_TOKENS,
  severity,
  tokens,
  USAGE_LEVELS,
} from "../../hooks/lib/_budget.mjs";

const root = path.join(import.meta.dir, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const PROMPT = "skills/apply-settings-profile/profiles/system-prompt.md";

test("the system prompt, profile, and option text use the budget's numbers", () => {
  expect(read(PROMPT)).toContain(
    `passes about ${k(MAIN_CONTEXT_TOKENS)} tokens`,
  );
  expect(read(PROMPT)).toContain(
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
  expect(read(".claude-plugin/plugin.json")).toContain(
    `on a context of ${k(STALE_CACHE_CONTEXT_TOKENS)} tokens or more`,
  );
  const skill = read("skills/apply-settings-profile/SKILL.md");
  expect(skill).toContain(`the ${k(MAIN_CONTEXT_TOKENS)} handoff point`);
  expect(skill).toContain(`the ${k(SUBAGENT_CONTEXT_TOKENS)} subagent budget`);
  expect(skill).toContain(
    `Colors change at ${USAGE_LEVELS[0]}% and ${USAGE_LEVELS[1]}%`,
  );
});

const body = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "");
const frontmatter = (file, key) =>
  new RegExp(`^${key}:\\s*"?(.*?)"?$`, "m").exec(
    read(file).split(/^---\s*$/m)[1] ?? "",
  )?.[1] ?? "";
const listed = (dir, pick) =>
  fs
    .readdirSync(path.join(root, dir))
    .map(pick)
    .filter((f) => f.endsWith(".md") && fs.existsSync(path.join(root, f)));
const agents = listed("agents", (f) => `agents/${f}`);
const skills = listed("skills", (d) => `skills/${d}/SKILL.md`);

/** Fail above the limit's fail value, and print above its warn value. */
function within(file, value, limit, unit) {
  const level = severity(value, limit);
  if (level === "warn")
    console.warn(
      `${file}: ${value} ${unit}, over the warn level ${limit.warn}`,
    );
  expect(level, `${file}: ${value} ${unit}`).not.toBe("fail");
}

test("the output style, system prompt, and agent bodies stay inside LIMITS", () => {
  within(
    "output style",
    tokens(body(read("output-styles/dotclaude.md"))),
    LIMITS.outputStyleTokens,
    "tokens",
  );
  within(
    "system prompt",
    tokens(read(PROMPT)),
    LIMITS.systemPromptTokens,
    "tokens",
  );
  for (const f of agents)
    within(f, tokens(body(read(f))), LIMITS.agentBodyTokens, "tokens");
});

// Agent Skills spec limits: name 64 characters, description 1024.
test("each skill stays inside LIMITS and the Agent Skills name and description limits", () => {
  for (const f of skills) {
    within(f, lineCount(read(f)), LIMITS.skillLines, "lines");
    within(f, tokens(body(read(f))), LIMITS.skillBodyTokens, "tokens");
    expect(frontmatter(f, "name").length, f).toBeLessThanOrEqual(64);
    expect(frontmatter(f, "description").length, f).toBeLessThanOrEqual(1024);
  }
});
