// Nested instruction files for paths a Bash command reads.
//
// Claude Code loads a subdirectory's CLAUDE.md when the Read tool opens a
// file below it, but not when Claude reads the file through Bash (`cat`,
// `sed -n`, `rg`), which Claude Code itself steers toward (#90450). These
// helpers find the files a Read would have loaded, so a PostToolUse hook can
// add them.

import fs from "node:fs";
import path from "node:path";
import { NESTED_INSTRUCTIONS_CHARS } from "./_budget.mjs";
import { parse } from "./_shell.mjs";
import { tail } from "./_transcript.mjs";

/** Programs whose path arguments are files Claude reads or searches. */
const READERS = new Set([
  "cat",
  "bat",
  "head",
  "tail",
  "sed",
  "awk",
  "less",
  "more",
  "nl",
  "grep",
  "rg",
  "tgrep",
]);

/** The files Claude Code loads for one directory, in its order. */
const NAMES = [
  "CLAUDE.md",
  path.join(".claude", "CLAUDE.md"),
  "CLAUDE.local.md",
];

const inside = (root, p) => {
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Existing paths under `root` that reader commands in `command` name. */
export function readPaths(command, cwd, root) {
  const found = new Set();
  for (const cmd of parse(command).commands) {
    if (!READERS.has(cmd.name)) continue;
    const base = path.resolve(cwd, cmd.cwdHint ?? ".");
    for (const arg of cmd.args) {
      if (arg.startsWith("-")) continue;
      const p = path.resolve(base, arg);
      if (inside(root, p) && fs.existsSync(p)) found.add(p);
    }
  }
  return [...found];
}

/**
 * Instruction files in the directories from below `root` down to `target`
 * (its directory when it is a file). The root's own files load at session
 * start, so they are not included.
 */
export function instructionFiles(target, root) {
  let dir = target;
  try {
    if (!fs.statSync(target).isDirectory()) dir = path.dirname(target);
  } catch {
    return [];
  }
  const dirs = [];
  for (; inside(root, dir); dir = path.dirname(dir)) dirs.unshift(dir);
  const files = [];
  for (const d of dirs)
    for (const name of NAMES) {
      const f = path.join(d, name);
      if (fs.existsSync(f)) files.push(f);
    }
  return files;
}

/** Paths that the transcript shows Claude Code loaded as nested memory. */
export function loadedInTranscript(transcriptPath) {
  const text = transcriptPath ? tail(transcriptPath) : null;
  const loaded = new Set();
  if (!text) return loaded;
  for (const line of text.split("\n")) {
    if (!line.includes('"nested_memory"')) continue;
    try {
      const att = JSON.parse(line).attachment;
      if (att?.type === "nested_memory" && att.path) loaded.add(att.path);
    } catch {
      // A line cut at the start of the tail.
    }
  }
  return loaded;
}

/**
 * The context text for `files`: each file's text while the total stays
 * inside NESTED_INSTRUCTIONS_CHARS, and the path alone for the rest.
 */
export function contextFor(files, root) {
  const parts = [];
  const named = [];
  let used = 0;
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8").trim();
    } catch {
      continue;
    }
    const rel = path.relative(root, f);
    if (used + text.length > NESTED_INSTRUCTIONS_CHARS) {
      named.push(rel);
      continue;
    }
    used += text.length;
    parts.push(
      `Contents of ${rel} (instructions for files in ${path.dirname(rel)}/):\n\n${text}`,
    );
  }
  if (named.length)
    parts.push(
      `These instruction files also apply and were too large to add here. Open them with the Read tool: ${named.join(", ")}`,
    );
  if (!parts.length) return null;
  return `The dotclaude plugin's PostToolUse hook added this note, not the command's output. The command read files in project directories that have their own CLAUDE.md files. Claude Code loads those files when the Read tool opens a file there, but not for Bash (#90450). They are project instructions, like the root CLAUDE.md. Follow them for files in those directories.\n\n${parts.join("\n\n")}`;
}
