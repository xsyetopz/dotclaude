#!/usr/bin/env bun
// Install or update the dotclaude section of a CLAUDE.md file.
//
//   bun apply-claude-md.mjs [--scope user|project] [--source file] [--remove] [--apply]
//
// The section sits between marker comments, so re-running replaces it in
// place and everything outside the markers is left untouched. Without
// --apply it prints what would change and writes nothing. With --apply it
// backs the file up next to itself first.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BEGIN =
  "<!-- dotclaude:begin (managed by /dotclaude:setup; edits inside this block are replaced) -->";
const END = "<!-- dotclaude:end -->";
const BLOCK = /<!-- dotclaude:begin[^\n]*-->[\s\S]*?<!-- dotclaude:end -->\n?/;

const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const scope = flag("--scope", "user");
const sourcePath = path.resolve(
  flag("--source", path.join(here, "..", "profiles", "global-claude-md.md")),
);
const remove = args.includes("--remove");
const apply = args.includes("--apply");
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const targets = {
  user: path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "CLAUDE.md",
  ),
  project: path.join(projectDir, "CLAUDE.md"),
};
if (!Object.hasOwn(targets, scope)) {
  console.error(`Unknown scope "${scope}". Use user or project.`);
  process.exit(2);
}
const target = targets[scope];
// The file's top-level heading is its own name (# CLAUDE.md, # AGENTS.md).
// A file that already opens with a top-level heading keeps its own.
const HEADING = `# ${path.basename(target)}`;
const withHeading = (text) =>
  /^\s*# /.test(text) ? text : `${HEADING}\n\n${text.replace(/^\s+/, "")}`;

// CLI tools worth naming in CLAUDE.md, listed only when present on PATH.
// Browser CLIs are left out: naming them here led Claude to drive them from
// Bash without loading the drive-web-browser skill that explains them. The
// dotclaude-browser plugin says when to load that skill.
const TOOLS = [
  "rg",
  "tgrep",
  "fd",
  "ast-grep",
  "jq",
  "yq",
  "gh",
  "git",
  "bun",
  "node",
  "uv",
  "python3",
  "shellcheck",
  "difft",
  "sd",
  "scc",
  "tokei",
  "dasel",
  "mlr",
  "codegraph",
];

// What each tool is for, named only when that tool is installed; the sizing
// and indexed-search entries stand in for reading or grepping many files.
const EXAMPLES = [
  [["tgrep"], "`tgrep` for indexed search in large repositories"],
  [["rg"], "`rg` for text"],
  [["fd"], "`fd` for files"],
  [["ast-grep"], "`ast-grep` for code structure"],
  [["scc", "tokei"], "{} to size a repository before reading its files"],
  [["jq"], "`jq` for JSON"],
  [["dasel", "mlr"], "{} for YAML, TOML, CSV, and other structured data"],
];

function examples() {
  const parts = EXAMPLES.flatMap(([names, text]) => {
    const found = names.filter((name) => Bun.which(name));
    if (!found.length) return [];
    return [text.replace("{}", found.map((n) => `\`${n}\``).join(" or "))];
  });
  if (!parts.length) return "";
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
  return `, for example ${list}`;
}

function installedTools() {
  const found = TOOLS.filter((name) => Bun.which(name));
  return found.length
    ? found.map((name) => `\`${name}\``).join(", ")
    : "none detected";
}
const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";

let next;
if (remove) {
  next = current.replace(BLOCK, "").replace(/\n{3,}$/, "\n\n");
} else {
  const body = fs
    .readFileSync(sourcePath, "utf8")
    .trim()
    .replace("{{TOOLS}}", installedTools())
    .replace("{{EXAMPLES}}", examples());
  const block = `${BEGIN}\n${body}\n${END}\n`;
  if (BLOCK.test(current)) next = withHeading(current.replace(BLOCK, block));
  else next = `${withHeading(current).replace(/\s*$/, "")}\n\n${block}`;
}

console.log(`Target: ${target} (${scope} scope)`);
if (next === current) {
  console.log("Already up to date; nothing to change.");
  process.exit(0);
}
const had = BLOCK.test(current);
console.log(
  remove
    ? "Removes the dotclaude section."
    : had
      ? "Replaces the existing dotclaude section."
      : "Appends a dotclaude section; the rest of the file is unchanged.",
);
if (!remove && !/^\s*# /.test(current)) {
  console.log(`Adds the top-level heading \`${HEADING}\` at the start.`);
}
if (!remove) {
  console.log(
    `\n----- section -----\n${next.match(BLOCK)[0]}-------------------`,
  );
}
if (!apply) {
  console.log("\nDry run: nothing was written. Re-run with --apply to write.");
  process.exit(0);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
if (current) {
  const backup = `${target}.dotclaude-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(target, backup);
  console.log(`\nBackup: ${backup}`);
}
fs.writeFileSync(target, next);
console.log(
  `Wrote ${target}. CLAUDE.md is read at session start, so the change applies to new sessions.`,
);
