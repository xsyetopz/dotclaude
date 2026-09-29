// Haiku 4.5 does not support the effort parameter (models/haiku-4-5/overview).
// `claude plugin validate --strict` accepts an `effort:` line on a Haiku agent,
// so this test is the only check.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const AGENTS = path.resolve(import.meta.dirname, "../../agents");

/** The frontmatter keys of an agent file. */
function frontmatter(file) {
  const text = fs.readFileSync(path.join(AGENTS, file), "utf8");
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  return Object.fromEntries(
    block
      .split("\n")
      .map((line) => line.match(/^(\w+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value]),
  );
}

test("an agent on Haiku 4.5 sets no effort", () => {
  const haiku = fs
    .readdirSync(AGENTS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f, frontmatter(f)])
    .filter(([, keys]) => keys.model?.startsWith("claude-haiku-4-5"));
  expect(haiku.length).toBeGreaterThan(0);
  expect(haiku.filter(([, keys]) => "effort" in keys).map(([f]) => f)).toEqual(
    [],
  );
});
