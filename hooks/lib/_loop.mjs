// State of a `slices` skill run, read from `.dotclaude/loop/` in the main
// project root:
//
// - `loop.json`: `{"oracle": "<command>", "protected": ["<glob>", ...]}`.
//   The protected globs are the frozen oracle (the tests that must stay
//   unchanged), relative to the project root.
// - `slices.jsonl`: one slice per line, `{"id", "status", ...}`. The status
//   goes `pending` -> `implemented` -> `reviewed` -> `merged`, or `failed`.
//
// A worktree agent works in `<root>/.claude/worktrees/<name>`, so paths in a
// worktree map back to the main root.

import { globFiles, globMatch } from "./_glob.mjs";
import { pathFor } from "./_path.mjs";

const WORKTREE = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/](.*))?$/;

/** The main root of the absolute path `abs`, as `path` writes it. */
const rootOf = (abs) => WORKTREE.exec(abs)?.[1] ?? abs;

/** The main project root of `dir`, also when `dir` is in an agent worktree. */
export async function mainRoot(io, dir) {
  return rootOf(pathFor(io.platform).resolve(io.cwd, dir));
}

const loopDir = (io, root) => {
  const path = pathFor(io.platform);
  return path.join(rootOf(path.resolve(io.cwd, root)), ".dotclaude", "loop");
};

/** `loop.json`, or null when no loop runs in this project. */
export async function loopConfig(io, root) {
  const path = pathFor(io.platform);
  try {
    const config = JSON.parse(
      await io.fs.read(path.join(loopDir(io, root), "loop.json")),
    );
    return config && typeof config === "object" ? config : null;
  } catch {
    return null;
  }
}

/** The slices, skipping lines that do not parse. */
export async function loopSlices(io, root) {
  const path = pathFor(io.platform);
  let text;
  try {
    text = await io.fs.read(path.join(loopDir(io, root), "slices.jsonl"));
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const slice = JSON.parse(line);
      if (slice && typeof slice === "object" && slice.id !== undefined)
        out.push(slice);
    } catch {
      // A line that Claude is writing now, or a typo. The others still count.
    }
  }
  return out;
}

/** `{done, total}` for the status line, or null when there are no slices. */
export async function loopProgress(io, root) {
  const slices = await loopSlices(io, root);
  if (!slices.length) return null;
  const done = slices.filter((s) => s.status === "merged").length;
  return { done, total: slices.length };
}

/** The protected globs of the loop in `root`, or an empty list. */
export async function protectedGlobs(io, root) {
  const globs = (await loopConfig(io, root))?.protected;
  return Array.isArray(globs)
    ? globs.filter((g) => typeof g === "string" && g.trim())
    : [];
}

/**
 * The path of `file` relative to its project root, with the worktree part
 * removed. Null when the file is outside the project.
 */
function projectPath(path, file, root, allowRoot = false) {
  const abs = path.resolve(root, file);
  const m = WORKTREE.exec(abs);
  const rel = m ? (m[2] ?? "") : path.relative(rootOf(path.resolve(root)), abs);
  if ((!rel && !allowRoot) || rel.startsWith("..") || path.isAbsolute(rel))
    return null;
  return rel.split(path.sep).join("/");
}

/** The first protected glob that `file` matches, or null. */
export function protectedMatch(file, root, globs, platform) {
  if (!globs.length) return null;
  const rel = projectPath(pathFor(platform), file, root);
  if (!rel) return null;
  return globs.find((g) => globMatch(g, rel)) ?? null;
}

/**
 * The first protected glob with a matching file under the directory `dir`,
 * or null. A removal of the directory removes that file too.
 */
export async function protectedUnder(io, dir, root, globs, platform) {
  if (!globs.length) return null;
  const path = pathFor(platform);
  const abs = path.resolve(root, dir);
  const rel = projectPath(path, abs, root, true);
  if (rel === null) return null;
  try {
    if ((await io.fs.stat(abs)).kind !== "dir") return null;
  } catch {
    return null;
  }
  const top = rel ? abs.slice(0, abs.length - rel.length - 1) : abs;
  for (const g of globs)
    for (const hit of await globFiles(io, g, {
      cwd: top,
      dot: true,
      onlyFiles: true,
    }))
      if (!rel || hit.split(path.sep).join("/").startsWith(`${rel}/`)) return g;
  return null;
}

/**
 * The oracle context for the edit and Bash guards: set for a subagent while a
 * loop with protected globs runs. The main conversation can change the
 * oracle, because the user directs it there.
 */
export async function oracleFor(io, data, root) {
  if (!data.agent_id) return undefined;
  const globs = await protectedGlobs(io, root);
  return globs.length ? { root, globs, platform: io.platform } : undefined;
}

export const PROTECTED_REASON = (glob) =>
  `the agent loop keeps the files that match \`${glob}\` unchanged, because they are the oracle that shows each slice is correct. A subagent cannot change them. Make the code pass the oracle. If the oracle itself is wrong, stop and say so in your report`;
