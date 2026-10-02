// Every file a SKILL.md names must exist, because the agent runs or reads it
// as written. Claude Code expands ${CLAUDE_SKILL_DIR} and ${CLAUDE_PLUGIN_ROOT}
// before the agent sees the text, so a wrong path fails only at run time.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILLS = path.join(ROOT, "skills");

const VAR_PATH = /\$\{(CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT)\}\/([\w./-]+)/g;
const LINK = /\]\(([^)\s#]+)(?:#[^)]*)?\)/g;
const TICKED = /`([\w.-]+\/[\w./-]+)`/g;

const isDir = (p) =>
  fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Paths in `text` that do not exist, relative to the skill directory. */
function missingPaths(skillDir, text) {
  const refs = [];
  for (const [, root, rel] of text.matchAll(VAR_PATH))
    refs.push(path.join(root === "CLAUDE_SKILL_DIR" ? skillDir : ROOT, rel));
  for (const [, target] of text.matchAll(LINK))
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target))
      refs.push(path.resolve(skillDir, target));
  // A bare `dir/file` counts only when `dir` is a folder of this skill, so
  // repository paths such as `hooks/...` in prose are not read as skill files.
  for (const [, rel] of text.matchAll(TICKED))
    if (isDir(path.join(skillDir, rel.split("/")[0])))
      refs.push(path.join(skillDir, rel));
  return [...new Set(refs)]
    .filter((p) => !fs.existsSync(p))
    .map((p) => path.relative(ROOT, p).split(path.sep).join("/"));
}

test("every path a SKILL.md names exists", () => {
  for (const name of fs.readdirSync(SKILLS)) {
    const dir = path.join(SKILLS, name);
    if (!isDir(dir)) continue;
    const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    expect(missingPaths(dir, text), name).toEqual([]);
  }
});

test("a wrong path is reported", () => {
  const dir = path.join(SKILLS, "setup");
  const text = `bun "\${CLAUDE_SKILL_DIR}/scripts/nope.mjs"
\${CLAUDE_PLUGIN_ROOT}/src/nope.mjs
[x](references/nope.md) [y](https://example.com)
\`profiles/nope.json\` \`hooks/lib/not-a-skill-file.mjs\`
`;
  expect(missingPaths(dir, text)).toEqual([
    "skills/setup/scripts/nope.mjs",
    "src/nope.mjs",
    "skills/setup/references/nope.md",
    "skills/setup/profiles/nope.json",
  ]);
});
