// dotclaude's usage bounds: every copy of a number agrees with _budget.mjs,
// and the text dotclaude adds to requests stays inside LIMITS. A warn prints
// and a fail fails the test.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  AUTO_COMPACT_TOKENS,
  COMPACTIONS_BEFORE_HANDOFF,
  k,
  LIMITS,
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

const STYLES = fs
  .readdirSync(path.join(root, "output-styles"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => `output-styles/${f}`);
const RULES = "hooks/session-start/working-rules.md";

// Each file that quotes a bound names it as a whole word, so a changed
// constant fails here until the file follows. The sentences around the
// numbers are free to change.
const QUOTED = {
  // The rules quote no bound: the plan note gives the compaction size.
  [RULES]: [],
  "skills/setup/SKILL.md": [
    MAIN_CONTEXT_TOKENS,
    AUTO_COMPACT_TOKENS,
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
    AUTO_COMPACT_TOKENS,
    SUBAGENT_CONTEXT_TOKENS,
    STALE_CACHE_CONTEXT_TOKENS,
  ].map(k),
);
const words = (n) => new RegExp(`(?<![\\w.])${n}(?![\\w.])`);

test("the working rules, skill, and option text quote the budget's token bounds", () => {
  for (const [file, bounds] of Object.entries(QUOTED)) {
    const text = read(file);
    for (const n of bounds) expect(text, file).toMatch(words(k(n)));
    for (const [, figure] of text.matchAll(/\b(\d+k) tokens\b/g))
      expect(BOUNDS.has(figure), `${file}: ${figure} tokens`).toBe(true);
  }
});

test("the working rules quote the compactions before a handoff", () => {
  const number = ["zero", "one", "two", "three", "four"][
    COMPACTIONS_BEFORE_HANDOFF
  ];
  expect(read(RULES)).toContain(`first ${number} compactions`);
});

test("the skill quotes the usage levels", () => {
  const [, low, high] =
    /(\d+)% and (\d+)%/.exec(read("skills/setup/SKILL.md")) ?? [];
  expect([Number(low), Number(high)]).toEqual(USAGE_LEVELS);
});

test("the recommended profile uses the budget's values", () => {
  const profile = JSON.parse(read("skills/setup/profiles/recommended.json"));
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
const listed = (dir, pick) =>
  fs
    .readdirSync(path.join(root, dir))
    .map(pick)
    .filter((f) => f.endsWith(".md") && fs.existsSync(path.join(root, f)));
const agents = listed("agents", (f) => `agents/${f}`);

/** Fail above the limit's fail value, and print above its warn value. */
function within(file, value, limit, unit) {
  const level = severity(value, limit);
  if (level === "warn")
    console.warn(
      `${file}: ${value} ${unit}, over the warn level ${limit.warn}`,
    );
  expect(level, `${file}: ${value} ${unit}`).not.toBe("fail");
}

test("the working rules, output styles, and agent bodies stay inside LIMITS", () => {
  const rules = Buffer.byteLength(read(RULES));
  within(RULES, rules, LIMITS.workingRulesBytes, "bytes");
  expect(STYLES).toHaveLength(4);
  for (const f of STYLES)
    within(f, tokens(body(read(f))), LIMITS.outputStyleTokens, "tokens");
  for (const f of agents)
    within(f, tokens(body(read(f))), LIMITS.agentBodyTokens, "tokens");
});
