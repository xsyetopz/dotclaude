// Commit and pull request attribution. Claude Code sends its attribution lines
// only while its built-in git instructions are on (2.1.283 bundle), and the
// settings profile turns those off for the output style's git section, so
// this note puts the lines back. It reads the same settings Claude Code does:
// `attribution.commit` and `attribution.pr` replace the defaults, an empty
// string removes one, and `includeCoAuthoredBy: false` removes both.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonical } from "./_models.mjs";

const PR_FOOTER =
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
const FALSE = new Set(["0", "false", "no", "off"]);

/** User, project, then local settings, merged key by key; later files win. */
function settings(projectDir) {
  const config =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const merged = {};
  for (const file of [
    path.join(config, "settings.json"),
    path.join(projectDir, ".claude", "settings.json"),
    path.join(projectDir, ".claude", "settings.local.json"),
  ]) {
    try {
      const s = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const key of ["includeGitInstructions", "includeCoAuthoredBy"])
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

/** The attribution note, or null when Claude Code sends its own or none. */
export function attributionNote(model, projectDir) {
  const s = settings(projectDir);
  const env = process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS;
  const builtIn =
    env !== undefined && env !== ""
      ? FALSE.has(env.trim().toLowerCase())
      : s.includeGitInstructions !== false;
  if (builtIn) return null;
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
  return `<git_attribution source="dotclaude">\n${lines.join("\n")}\n</git_attribution>`;
}
