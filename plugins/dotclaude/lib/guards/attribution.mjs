// Git attribution. Claude Code sends its `Co-Authored-By` trailer and pull
// request footer only with its built-in git instructions, and the setup
// profile turns those off (`includeGitInstructions: false`). The session note
// puts the lines back in a repository of the user or of an organization that
// the user owns, from the same settings that Claude Code reads. A repository
// with a remote of another owner gets no lines, because the AI policy of that
// project decides. The Bash guard denies a Claude trailer that the settings
// leave out (Claude adds it from habit, claude-code #4287 and #93007), and it
// asks before a Claude attribution line in a repository of another owner.
// These functions are pure, because the hooks module has no Node. The callers
// read the files and run the commands.

import { cite, ruleText, section } from "../terms.mjs";

const PR_FOOTER =
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)";

export const OTHER_OWNER_NOTE = section(
  "git-attribution",
  `This repository has a remote of another owner, so the AI policy of that project decides the attribution.
Before a commit or a pull request, read the policy, such as \`CONTRIBUTING.md\` or \`AI_POLICY.md\`.
${ruleText("attribution-other-owner")}
For an issue, a pull request, or a comment, use the \`dotclaude:contribute\` skill.`,
);

export const TRAILER_OFF_REASON = `The commit message has a Claude \`Co-Authored-By\` line, and the attribution settings of the user leave it out. Remove the line from the message, then run the same commit again. ${cite("attribution-lines")}`;

export const OTHER_OWNER_REASON = `The commit message has a Claude attribution line, and this repository has a remote of another owner. The AI policy of that project decides if the line can stay. Read the policy, and keep the line only if the policy asks for it. ${cite("attribution-other-owner")}`;

export const CLAUDE_TRAILER =
  /(^|[\s"'])co-authored-by:[^\n]*(claude|anthropic)/im;
const CLAUDE_ATTRIBUTION =
  /(^|[\s"'])((co-authored|co-developed|assisted|generated)-by:[^\n]*(claude|anthropic)|generated with \[?claude code)/im;

/** True when `text` has a Claude attribution line of any form. */
export const hasClaudeAttribution = (text) => CLAUDE_ATTRIBUTION.test(text);

export const LOGIN_ARGV = ["gh", "config", "get", "user", "-h", "github.com"];
// GitHub records no organization creator, so the owner role (`admin`) stands
// for it. This call goes to the network, so the callers run it only when a
// remote is not under the login.
export const ORGS_ARGV = [
  "gh",
  "api",
  "user/memberships/orgs",
  "--paginate",
  "--jq",
  '.[] | select(.role == "admin" and .state == "active") | .organization.login',
];

/** The lines of a command output, without empty lines. */
export const linesOf = (text) =>
  (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** The user, project, and local settings files, in the order that they win. */
export const settingsPaths = (configDir, root) => [
  `${configDir}/settings.json`,
  `${root}/.claude/settings.json`,
  `${root}/.claude/settings.local.json`,
];

/** The settings texts, merged key by key; later texts win. */
export function mergeSettings(texts) {
  const merged = {};
  for (const text of texts) {
    try {
      const s = JSON.parse(text);
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

/** `Claude Opus 5.5` for `claude-opus-5-5`, and `Claude` for other names. */
export function modelName(model = "") {
  const m = /^claude-(opus|sonnet|haiku)-(\d+)-(\d)\b/.exec(model);
  return m
    ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`
    : "Claude";
}

/**
 * True when each line of `git remote -v` is a GitHub remote of one of
 * `owners`. A fork with an `upstream` of another owner is not the user's own.
 */
export function ownRepo(remotes, owners) {
  const own = new RegExp(`github\\.com[:/](${owners.join("|")})/`, "i");
  return remotes
    .split("\n")
    .every((line) => !line || (owners.length > 0 && own.test(line)));
}

/**
 * True when the settings leave the Claude trailer out of commits: an
 * `attribution.commit` without it, or `includeCoAuthoredBy: false`.
 */
export function trailerOff(s) {
  if (s.attribution)
    return (
      typeof s.attribution.commit === "string" &&
      !CLAUDE_TRAILER.test(s.attribution.commit)
    );
  return s.includeCoAuthoredBy === false;
}

/** The note for a repository of the user, or null when Claude Code sends its own. */
export function attributionNote(model, s) {
  if (s.includeGitInstructions !== false) return null;
  // Claude Code 2.1.289 gives no `model` to a SessionStart command hook, and
  // `/model` can change it later, so then Claude writes the name of its model.
  const name = modelName(model);
  let commit = `Co-Authored-By: ${name === "Claude" ? "<model>" : name} <noreply@anthropic.com>`;
  let pr = PR_FOOTER;
  if (s.attribution) ({ commit = commit, pr = pr } = s.attribution);
  else if (s.includeCoAuthoredBy === false) commit = pr = "";
  const lines = [];
  if (commit)
    lines.push(
      commit.includes("<model>")
        ? `End each commit message with a blank line, then this text.\nChange \`<model>\` to the name of the model that you run on, such as \`Claude Opus 5.5\`:\n${commit}`
        : `End each commit message with a blank line, then this text exactly:\n${commit}`,
    );
  if (pr)
    lines.push(
      `End each pull request body with a blank line, then this text exactly:\n${pr}`,
    );
  return lines.length
    ? section(
        "git-attribution",
        `${ruleText("attribution-lines")}\n${lines.join("\n")}`,
      )
    : null;
}
