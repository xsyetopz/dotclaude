// dotclaude's usage bounds: every copy of a number agrees with _budget.mjs,
// and the text dotclaude adds to requests stays inside LIMITS. A warn prints
// and a fail fails the test.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  COMPACTIONS_BEFORE_HANDOFF,
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

// Each file that quotes a bound names it as a whole word, so a changed
// constant fails here until the file follows. The sentences around the
// numbers are free to change.
const QUOTED = {
  [PROMPT]: [MAIN_CONTEXT_TOKENS, SUBAGENT_CONTEXT_TOKENS],
  "skills/apply-settings-profile/SKILL.md": [
    MAIN_CONTEXT_TOKENS,
    SUBAGENT_CONTEXT_TOKENS,
  ],
  ".claude-plugin/plugin.json": [
    SUBAGENT_CONTEXT_TOKENS,
    STALE_CACHE_CONTEXT_TOKENS,
  ],
};
const BOUNDS = new Set(
  [
    MAIN_CONTEXT_TOKENS,
    SUBAGENT_CONTEXT_TOKENS,
    STALE_CACHE_CONTEXT_TOKENS,
  ].map(k),
);
const words = (n) => new RegExp(`(?<![\\w.])${n}(?![\\w.])`);

test("the system prompt, skill, and option text quote the budget's token bounds", () => {
  for (const [file, bounds] of Object.entries(QUOTED)) {
    const text = read(file);
    for (const n of bounds) expect(text, file).toMatch(words(k(n)));
    for (const [, figure] of text.matchAll(/\b(\d+k) tokens\b/g))
      expect(BOUNDS.has(figure), `${file}: ${figure} tokens`).toBe(true);
  }
});

test("the system prompt quotes the compactions before a handoff", () => {
  const number = ["zero", "one", "two", "three", "four"][
    COMPACTIONS_BEFORE_HANDOFF
  ];
  expect(read(PROMPT)).toContain(`first ${number} compactions`);
});

test("the skill quotes the usage levels", () => {
  const [, low, high] =
    /(\d+)% and (\d+)%/.exec(read("skills/apply-settings-profile/SKILL.md")) ??
    [];
  expect([Number(low), Number(high)]).toEqual(USAGE_LEVELS);
});

test("the recommended profile uses the budget's values", () => {
  const profile = JSON.parse(
    read("skills/apply-settings-profile/profiles/recommended.json"),
  );
  expect(profile.autoCompactWindow).toBe(MAIN_CONTEXT_TOKENS);
  // The community figure; a cap of 3 caused 50 of 77 `Agent` errors.
  expect(MAX_CONCURRENT_AGENTS).toBe(5);
  expect(profile.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe(
    String(MAX_CONCURRENT_AGENTS),
  );
  expect(profile.env.CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS).toBe(
    String(MAX_CONCURRENT_AGENTS),
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
const skills = [
  ...listed("skills", (d) => `skills/${d}/SKILL.md`),
  ...listed(
    "plugins/dotclaude-browser/skills",
    (d) => `plugins/dotclaude-browser/skills/${d}/SKILL.md`,
  ),
];

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
    within(
      f,
      frontmatter(f, "description").length +
        frontmatter(f, "when_to_use").length,
      LIMITS.skillDescriptionChars,
      "description characters",
    );
  }
});
