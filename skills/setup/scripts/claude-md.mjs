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

const BEGIN = "<!-- dotclaude:begin (managed by /dotclaude:setup) -->";
const END = "<!-- dotclaude:end -->";
const BLOCK = /<!-- dotclaude:begin[^\n]*-->[\s\S]*?<!-- dotclaude:end -->\n?/;

const body = fs.readFileSync(
  path.join(import.meta.dirname, "..", "profiles", "global-claude-md.md"),
  "utf8",
);
const block = `${BEGIN}\n${body.trimEnd()}\n${END}\n`;
const file = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
  "CLAUDE.md",
);
const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const next = BLOCK.test(current)
  ? current.replace(BLOCK, block)
  : `${current}${current && !current.endsWith("\n\n") ? "\n" : ""}${block}`;

console.log(`Target: ${file}`);
if (next === current) {
  console.log("The block is up to date.");
  process.exit(0);
}
console.log(block);
if (!process.argv.includes("--apply")) {
  console.log("Dry run. Run again with --apply to write the block.");
  process.exit(0);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
if (current) {
  const backup = `${file}.dotclaude-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(file, backup);
  console.log(`Backup: ${backup}`);
}
fs.writeFileSync(file, next);
console.log(`Wrote ${file}.`);
