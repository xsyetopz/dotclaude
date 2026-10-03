// Nested instruction files for paths a Bash command reads.
//
// Claude Code loads a subdirectory's CLAUDE.md when the Read tool opens a
// file below it, but not when Claude reads the file through Bash (`cat`,
// `sed -n`, `rg`), which Claude Code itself steers toward (#90450). These
// helpers find the files a Read would have loaded, so a PostToolUse hook can
// add them.

import { NESTED_INSTRUCTIONS_CHARS } from "./_budget.mjs";
import { pathFor, posix } from "./_path.mjs";
import { parse } from "./_shell.mjs";

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
const NAMES = [["CLAUDE.md"], [".claude", "CLAUDE.md"], ["CLAUDE.local.md"]];

const inside = (path, root, p) => {
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Existing paths under `root` that reader commands in `command` name. */
export async function readPaths(io, command, cwd, root) {
  const path = pathFor(io.platform);
  const found = new Set();
  for (const cmd of parse(command).commands) {
    if (!READERS.has(cmd.name)) continue;
    const base = path.resolve(cwd, cmd.cwdHint ?? ".");
    for (const arg of cmd.args) {
      if (arg.startsWith("-")) continue;
      const p = path.resolve(base, arg);
      if (inside(path, root, p) && (await io.fs.exists(p))) found.add(p);
    }
  }
  return [...found];
}

/**
 * True when `dir` is a git worktree of the project at `root`.
 * Its `.git` file then points into the project's `.git/worktrees/`.
 * A submodule's `.git` file points into `.git/modules/`.
 */
async function worktreeOf(io, dir, root) {
  const path = pathFor(io.platform);
  let text;
  try {
    text = await io.fs.read(path.join(dir, ".git"));
  } catch {
    return false;
  }
  const gitdir = /^gitdir: (.+)$/m.exec(text)?.[1].trim();
  return (
    !!gitdir &&
    inside(
      path,
      path.join(root, ".git", "worktrees"),
      path.resolve(dir, gitdir),
    )
  );
}

/**
 * Instruction files in the directories from below `root` down to `target`
 * (its directory when it is a file). The root's own files load at session
 * start, so they are not included.
 * A worktree of the project is a checkout of the same files, so it is a root too.
 */
export async function instructionFiles(io, target, root) {
  const path = pathFor(io.platform);
  let dir = target;
  try {
    if ((await io.fs.stat(target)).kind !== "dir") dir = path.dirname(target);
  } catch {
    return [];
  }
  const dirs = [];
  for (; inside(path, root, dir); dir = path.dirname(dir)) {
    if (await worktreeOf(io, dir, root)) break;
    dirs.unshift(dir);
  }
  const files = [];
  for (const d of dirs)
    for (const name of NAMES) {
      const f = path.join(d, ...name);
      if (await io.fs.exists(f)) files.push(f);
    }
  return files;
}

/**
 * The context text for `files`: each file's text while the total stays
 * inside NESTED_INSTRUCTIONS_CHARS, and the path alone for the rest.
 */
export async function contextFor(io, files, root) {
  const path = pathFor(io.platform);
  const parts = [];
  const named = [];
  let used = 0;
  for (const f of files) {
    let text;
    try {
      text = (await io.fs.read(f)).trim();
    } catch {
      continue;
    }
    const rel = path.relative(root, f).split(path.sep).join("/");
    if (used + text.length > NESTED_INSTRUCTIONS_CHARS) {
      named.push(rel);
      continue;
    }
    used += text.length;
    parts.push(
      `Contents of \`${rel}\` (instructions for files in \`${posix.dirname(rel)}/\`):\n\n${text}`,
    );
  }
  if (named.length)
    parts.push(
      `These instruction files also apply, but they are too large to add here. Open them with the \`Read\` tool: ${named.map((f) => `\`${f}\``).join(", ")}`,
    );
  if (!parts.length) return null;
  return `The dotclaude plugin's \`PostToolUse\` hook added this note, not the command's output. The command read files in project directories that have their own \`CLAUDE.md\` files. Claude Code loads those files when the \`Read\` tool opens a file there, but not for \`Bash\` (#90450). They are project instructions, like the root \`CLAUDE.md\`. Follow them for files in those directories.\n\n${parts.join("\n\n")}`;
}
