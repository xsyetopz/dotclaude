// Commit and pull request attribution. Claude Code sends its attribution lines
// only while its built-in git instructions are on (2.1.283 bundle), and the
// settings profile turns those off for the output style's git section, so
// this note puts the lines back. It reads the same settings Claude Code does:
// `attribution.commit` and `attribution.pr` replace the defaults, an empty
// string removes one, and `includeCoAuthoredBy: false` removes both. The same
// instructions carry the pre-commit skill line (2.1.286 bundle), which
// `preCommitNote` puts back.

import { canonical } from "./_models.mjs";
import { pathFor } from "./_path.mjs";

const PR_FOOTER =
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
const FALSE = new Set(["0", "false", "no", "off"]);

const configDir = (io) =>
  io.env.CLAUDE_CONFIG_DIR || pathFor(io.platform).join(io.home, ".claude");

/** User, project, then local settings, merged key by key; later files win. */
async function settings(io, projectDir) {
  const path = pathFor(io.platform);
  const config = configDir(io);
  const merged = {};
  for (const file of [
    path.join(config, "settings.json"),
    path.join(projectDir, ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.local.json"),
  ]) {
    try {
      const s = JSON.parse(await io.fs.read(file));
      for (const key of [
        "includeGitInstructions",
        "includeCoAuthoredBy",
        "includeCodeReviewSuggestion",
      ])
        if (key in s) merged[key] = s[key];
      if (s.attribution && typeof s.attribution === "object")
        merged.attribution = { ...merged.attribution, ...s.attribution };
    } catch {
      // Missing or unreadable: Claude Code skips it too.
    }
  }
  return merged;
}

/** `Claude Opus 5.5` for `claude-opus-5-5`; Claude Code names Fable `Claude`. */
export function modelName(model) {
  const m = /^claude-([a-z]+)-(\d+(?:-\d)?)(?:-|$)/.exec(
    canonical(model ?? ""),
  );
  if (!m || m[1] === "fable") return "Claude";
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return `Claude ${family} ${m[2].replace("-", ".")}`;
}

/**
 * True when the settings leave no Claude co-author line in commits: a
 * configured `attribution.commit` without one, or `includeCoAuthoredBy: false`.
 * Opus 5.5 still adds the line from habit (claude-code #4287, #93007).
 */
export async function claudeTrailerOff(io, projectDir) {
  const s = await settings(io, projectDir);
  if (s.attribution)
    return (
      typeof s.attribution.commit === "string" &&
      !CLAUDE_TRAILER.test(s.attribution.commit)
    );
  return s.includeCoAuthoredBy === false;
}

export const CLAUDE_TRAILER =
  /(^|[\s"'])co-authored-by:[^\n]*(claude|anthropic)/im;

/** True when Claude Code sends its own git instructions. */
function builtInGit(s, env) {
  const off = env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS;
  return off !== undefined && off !== ""
    ? FALSE.has(off.trim().toLowerCase())
    : s.includeGitInstructions !== false;
}

/** The attribution note, or null when Claude Code sends its own or none. */
export async function attributionNote(io, model, projectDir) {
  const s = await settings(io, projectDir);
  if (builtInGit(s, io.env)) return null;
  let commit = `Co-Authored-By: ${modelName(model)} <noreply@anthropic.com>`;
  let pr = PR_FOOTER;
  if (s.attribution) {
    commit = s.attribution.commit ?? commit;
    pr = s.attribution.pr ?? pr;
  } else if (s.includeCoAuthoredBy === false) {
    commit = "";
    pr = "";
  }
  const lines = [];
  if (commit)
    lines.push(
      `End each commit message with a blank line, then these lines exactly:\n${commit}`,
    );
  if (pr)
    lines.push(
      `End each pull request body with a blank line, then these lines exactly:\n${pr}`,
    );
  if (!lines.length) return null;
  return `<git_attribution>\n${lines.join("\n")}\n</git_attribution>`;
}

// Claude Code 2.1.286 names `verify` and `simplify` only when they load from a
// user or project `skills/<name>/` folder, or from the older `commands/`
// folder. A plugin or bundled skill of the same name does not count. It adds
// the built-in `code-review` when `includeCodeReviewSuggestion` is true.
// A sandbox capture of the request confirmed each case.
const PRE_COMMIT_SKILLS = ["verify", "simplify"];

async function hasSkill(io, projectDir, name) {
  const path = pathFor(io.platform);
  for (const dir of [configDir(io), path.join(projectDir, ".claude")])
    if (
      (await io.fs.exists(path.join(dir, "skills", name, "SKILL.md"))) ||
      (await io.fs.exists(path.join(dir, "commands", `${name}.md`)))
    )
      return true;
  return false;
}

/**
 * The line that tells Claude which skills to run before a commit, or null
 * when Claude Code sends it or no skill applies.
 */
export async function preCommitNote(io, projectDir) {
  const s = await settings(io, projectDir);
  if (builtInGit(s, io.env)) return null;
  const names = [];
  for (const n of PRE_COMMIT_SKILLS)
    if (await hasSkill(io, projectDir, n)) names.push(`\`/${n}\``);
  if (s.includeCodeReviewSuggestion === true)
    names.push("`/code-review medium`");
  if (!names.length) return null;
  const list =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
  return `<git_pre_commit>\nRun ${list} right before each \`git commit\`, so that the checks run on the change that you commit.\nDo not run ${names.length === 1 ? "it" : "them"} before a commit that changes only docs or tests.\n</git_pre_commit>`;
}
