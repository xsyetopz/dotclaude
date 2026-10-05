#!/usr/bin/env bun
// Install or update the dotclaude block of `~/.claude/CLAUDE.md`.
//
//   bun claude-md.mjs [--apply]
//
// The block sits between marker comments, so a second run replaces it in
// place and leaves the rest of the file alone. Without --apply, it prints the
// block and writes nothing. With --apply, it backs the file up first.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withClaudeMdBlock } from "../../../lib/setup/diff.mjs";
import { backup } from "../../../lib/setup/files.mjs";

const body = fs.readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "templates",
    "CLAUDE.md.block",
  ),
  "utf8",
);
const file = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
  "CLAUDE.md",
);
const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const { block, text: next, legacy } = withClaudeMdBlock(current, body);

console.log(`Target: ${file}`);
if (next === current) {
  console.log("The block is up to date.");
  process.exit(0);
}
console.log(block);
if (legacy)
  console.log(
    "Removes the CodeGraph section (<!-- CODEGRAPH_START --> to <!-- CODEGRAPH_END -->), because the block has its own CodeGraph rule.",
  );
if (!process.argv.includes("--apply")) {
  console.log("Dry run. Run again with --apply to write the block.");
  process.exit(0);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
if (current) {
  const { made, deleted } = backup(file);
  console.log(`Backup: ${made}`);
  for (const f of deleted) console.log(`Deleted old backup: ${f}`);
}
fs.writeFileSync(file, next);
console.log(`Wrote ${file}.`);
