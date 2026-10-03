// dotclaude's usage bounds: each config copy of a number agrees with
// _budget.mjs, and the text dotclaude adds to requests stays inside LIMITS.
// A warn prints and a fail fails the test.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  LIMITS,
  MAIN_CONTEXT_TOKENS,
  MAX_CONCURRENT_AGENTS,
  severity,
  tokens,
} from "../../hooks/lib/_budget.mjs";

const root = path.join(import.meta.dir, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const STYLES = fs
  .readdirSync(path.join(root, "output-styles"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => `output-styles/${f}`);
const RULES = "hooks/session-start/working-rules.md";

test("the recommended profile uses the budget's values", () => {
  const profile = JSON.parse(read("skills/setup/profiles/recommended.json"));
  expect(profile.autoCompactWindow).toBe(MAIN_CONTEXT_TOKENS);
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
  for (const f of STYLES)
    within(f, tokens(body(read(f))), LIMITS.outputStyleTokens, "tokens");
  for (const f of agents)
    within(f, tokens(body(read(f))), LIMITS.agentBodyTokens, "tokens");
});
