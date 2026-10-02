// PostToolUse: when an agent creates a file that describes one session or
// one user, add it to `.git/info/exclude`, so it stays out of commits without
// a change to the project's tracked `.gitignore`. Prints nothing.
//
// Only paths whose own docs say "do not commit" are here. OpenSpec
// (`openspec/`) and Spec Kit (`.specify/`) tell users to commit their files,
// so they are not.

import { git } from "../lib/_bash-args.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import { pathFor } from "../lib/_path.mjs";

// [test on the repo-relative path, entry for the exclude file]
const SESSION_FILES = [
  // dotclaude: the notes of the `handoff` skill.
  [(rel) => rel.startsWith(".claude/handoffs/"), () => "/.claude/handoffs/"],
  // dotclaude: `slices` skill state.
  [(rel) => rel.startsWith(".dotclaude/"), () => "/.dotclaude/"],
  // Claude Code docs: personal memory and settings, and `--worktree` checkouts.
  [(rel) => rel.split("/").pop() === "CLAUDE.local.md", (rel) => `/${rel}`],
  [
    (rel) => rel === ".claude/settings.local.json",
    () => "/.claude/settings.local.json",
  ],
  [
    (rel) =>
      rel === ".claude/worktrees" || rel.startsWith(".claude/worktrees/"),
    () => "/.claude/worktrees/",
  ],
];

/** The exclude entry for `abs`, with the repo root, or undefined. */
async function entryFor(io, abs) {
  const path = pathFor(io.platform);
  let dir = abs;
  let base = "";
  try {
    const { kind } = await io.fs.stat(abs);
    // A dangling link is `other` here, and the old `statSync` threw for it.
    if (kind === "file") {
      dir = path.dirname(abs);
      base = path.basename(abs);
    } else if (kind !== "dir") return undefined;
  } catch {
    return undefined;
  }
  // git gives the folder's path below the top level, with `/`. A path
  // comparison with the top level fails where the two name one folder
  // differently: `/private/var` on macOS, `RUNNER~1` short names on Windows.
  const out = await git(io, dir, [
    "rev-parse",
    "--show-toplevel",
    "--show-prefix",
  ]);
  const [top, prefix] = (out ?? "").split("\n");
  if (!top) return undefined;
  const rel = `${prefix}${base}`.replace(/\/$/, "");
  if (!rel) return undefined;
  const hit = SESSION_FILES.find(([test]) => test(rel));
  return hit && { top, rel, entry: hit[1](rel) };
}

async function exclude(io, abs) {
  const path = pathFor(io.platform);
  const found = await entryFor(io, abs);
  if (!found) return;
  const { top, rel, entry } = found;
  // `check-ignore -q` exits 0 (empty output) only for an ignored path.
  if ((await git(io, top, ["check-ignore", "-q", "--", rel])) !== undefined)
    return;
  const file = (
    await git(io, top, ["rev-parse", "--git-path", "info/exclude"])
  )?.trim();
  if (!file) return;
  const target = path.resolve(top, file);
  const old = (await io.fs.exists(target)) ? await io.fs.read(target) : "";
  if (old.split("\n").includes(entry)) return;
  const sep = old === "" || old.endsWith("\n") ? "" : "\n";
  await io.fs.append(target, `${sep}${entry}\n`);
}

export default async function (io, data) {
  const path = pathFor(io.platform);
  if (!option(io.env, "context_session_files")) return;
  const input = data.tool_input ?? {};
  if (data.tool_name === "EnterWorktree") {
    const dir = path.join(projectRoot(io, data), ".claude", "worktrees");
    if (await io.fs.exists(dir)) await exclude(io, dir);
    return;
  }
  const file = input.file_path || input.notebook_path;
  if (typeof file === "string" && file)
    await exclude(io, path.resolve(io.cwd, file));
}
