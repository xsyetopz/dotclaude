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

import fs from "node:fs";
import path from "node:path";

const WORKTREE = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/](.*))?$/;

/** The main project root of `dir`, also when `dir` is in an agent worktree. */
export function mainRoot(dir) {
  const m = WORKTREE.exec(path.resolve(dir));
  return m ? m[1] : path.resolve(dir);
}

const loopDir = (root) => path.join(mainRoot(root), ".dotclaude", "loop");

/** `loop.json`, or null when no loop runs in this project. */
export function loopConfig(root) {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(loopDir(root), "loop.json"), "utf8"),
    );
    return config && typeof config === "object" ? config : null;
  } catch {
    return null;
  }
}

/** The slices, skipping lines that do not parse. */
export function loopSlices(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(loopDir(root), "slices.jsonl"), "utf8");
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
export function loopProgress(root) {
  const slices = loopSlices(root);
  if (!slices.length) return null;
  const done = slices.filter((s) => s.status === "merged").length;
  return { done, total: slices.length };
}

/** The protected globs of the loop in `root`, or an empty list. */
export function protectedGlobs(root) {
  const globs = loopConfig(root)?.protected;
  return Array.isArray(globs)
    ? globs.filter((g) => typeof g === "string" && g.trim())
    : [];
}

/**
 * The path of `file` relative to its project root, with the worktree part
 * removed. Null when the file is outside the project.
 */
function projectPath(file, root, allowRoot = false) {
  const abs = path.resolve(root, file);
  const m = WORKTREE.exec(abs);
  const rel = m ? (m[2] ?? "") : path.relative(mainRoot(root), abs);
  if ((!rel && !allowRoot) || rel.startsWith("..") || path.isAbsolute(rel))
    return null;
  return rel.split(path.sep).join("/");
}

/** The first protected glob that `file` matches, or null. */
export function protectedMatch(file, root, globs = protectedGlobs(root)) {
  if (!globs.length) return null;
  const rel = projectPath(file, root);
  if (!rel) return null;
  return globs.find((g) => new Bun.Glob(g).match(rel)) ?? null;
}

/**
 * The first protected glob with a matching file under the directory `dir`,
 * or null. A removal of the directory removes that file too.
 */
export function protectedUnder(dir, root, globs = protectedGlobs(root)) {
  if (!globs.length) return null;
  const abs = path.resolve(root, dir);
  const rel = projectPath(abs, root, true);
  if (rel === null) return null;
  try {
    if (!fs.statSync(abs).isDirectory()) return null;
  } catch {
    return null;
  }
  const top = rel ? abs.slice(0, abs.length - rel.length - 1) : abs;
  for (const g of globs)
    for (const hit of new Bun.Glob(g).scanSync({ cwd: top, dot: true }))
      if (!rel || hit.split(path.sep).join("/").startsWith(`${rel}/`)) return g;
  return null;
}

/**
 * The oracle context for the edit and Bash guards: set for a subagent while a
 * loop with protected globs runs. The main conversation can change the
 * oracle, because the user directs it there.
 */
export function oracleFor(data, root) {
  if (!data.agent_id) return undefined;
  const globs = protectedGlobs(root);
  return globs.length ? { root, globs } : undefined;
}

export const PROTECTED_REASON = (glob) =>
  `the agent loop keeps the files that match \`${glob}\` unchanged, because they are the oracle that shows each slice is correct. A subagent cannot change them. Make the code pass the oracle. If the oracle itself is wrong, stop and say so in your report`;
