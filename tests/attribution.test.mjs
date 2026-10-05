// Git attribution: the trailer and footer from the settings in a repository
// of the user, the policy note in a repository of another owner, and the
// trailer check of the Bash guard.

import { expect, test } from "bun:test";
import {
  attributionNote,
  hasClaudeAttribution,
  mergeSettings,
  modelName,
  ownRepo,
  trailerOff,
} from "../hooks/lib/_attribution.mjs";
import { gitNote } from "../hooks/session-start/context.mjs";

const remote = (url) => `origin\t${url} (fetch)\norigin\t${url} (push)\n`;
const OFF = { includeGitInstructions: false };

test("modelName follows the Claude Code trailer names", () => {
  expect(modelName("claude-opus-5-5")).toBe("Claude Opus 5.5");
  expect(modelName("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
  expect(modelName("claude-fable-5-1")).toBe("Claude");
  expect(modelName(undefined)).toBe("Claude");
});

test("a repository is the user's own only when each remote is under an owner", () => {
  expect(ownRepo("", [])).toBe(true);
  expect(ownRepo(remote("git@github.com:Me/x.git"), ["me"])).toBe(true);
  expect(ownRepo(remote("https://github.com/me/x"), ["me"])).toBe(true);
  expect(ownRepo(remote("https://github.com/meta/x"), ["me"])).toBe(false);
  expect(ownRepo(remote("https://gitlab.com/me/x"), ["me"])).toBe(false);
  expect(ownRepo(remote("https://github.com/me/x"), [])).toBe(false);
  const fork =
    remote("https://github.com/me/x") +
    remote("https://github.com/them/x").replaceAll("origin", "upstream");
  expect(ownRepo(fork, ["me"])).toBe(false);
  expect(ownRepo(fork, ["me", "them"])).toBe(true);
});

test("later settings win key by key, and bad JSON is skipped", () => {
  const s = mergeSettings([
    JSON.stringify({ ...OFF, attribution: { pr: "" } }),
    "{",
    "",
    JSON.stringify({ attribution: { commit: "Assisted-by: Claude" } }),
  ]);
  expect(s).toEqual({
    ...OFF,
    attribution: { pr: "", commit: "Assisted-by: Claude" },
  });
});

test("with the built-in git instructions, no note", () => {
  expect(attributionNote("claude-opus-5-5", {})).toBeNull();
});

test("the user's own repository gets the default trailer and footer", () => {
  const note = attributionNote("claude-opus-5-5", OFF);
  expect(note).toContain(
    "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
  );
  expect(note).toContain("Generated with [Claude Code]");
});

test("without the model in the hook input, Claude writes its model name", () => {
  const note = attributionNote(undefined, OFF);
  expect(note).toContain("Co-Authored-By: <model> <noreply@anthropic.com>");
  expect(note).toContain("changed to the name of the model that you run on");
  expect(note).not.toContain("this text exactly:\nCo-Authored-By");
});

test("the attribution settings change or remove the lines", () => {
  const note = attributionNote("claude-opus-5-5", {
    ...OFF,
    attribution: { pr: "", commit: "Assisted-by: Claude" },
  });
  expect(note).toContain("Assisted-by: Claude");
  expect(note).not.toContain("Co-Authored-By");
  expect(note).not.toContain("pull request");
  expect(
    attributionNote("claude-opus-5-5", { ...OFF, includeCoAuthoredBy: false }),
  ).toBeNull();
});

test("trailerOff follows `attribution.commit`, then `includeCoAuthoredBy`", () => {
  expect(trailerOff({})).toBe(false);
  expect(trailerOff({ includeCoAuthoredBy: false })).toBe(true);
  expect(trailerOff({ attribution: { commit: "" } })).toBe(true);
  expect(trailerOff({ attribution: { pr: "" } })).toBe(false);
  expect(
    trailerOff({
      includeCoAuthoredBy: false,
      attribution: { commit: "Co-Authored-By: Claude <noreply@anthropic.com>" },
    }),
  ).toBe(false);
});

test("hasClaudeAttribution finds each Claude attribution form", () => {
  for (const line of [
    "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    "Assisted-by: Claude",
    "Generated-by: Anthropic model",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  ])
    expect(hasClaudeAttribution(`git commit -m "x\n\n${line}"`)).toBe(true);
  expect(hasClaudeAttribution('git commit -m "Co-Authored-By: Ann"')).toBe(
    false,
  );
  expect(hasClaudeAttribution('git commit -m "Fix the claude parser"')).toBe(
    false,
  );
});

/** A fake command runner with these outputs; null is a failed command. */
const fake =
  (remotes, login = "me", orgs = "") =>
  (argv) =>
    argv[0] === "git" ? remotes : argv.includes("config") ? login : orgs;
const env = { CLAUDE_CONFIG_DIR: "/nonexistent-dotclaude" };

test("gitNote gives no note outside git", () => {
  expect(gitNote("claude-opus-5-5", "/x", fake(null), env)).toBeNull();
});

test("gitNote gives the policy note in a repository of another owner", () => {
  const note = gitNote(
    "claude-opus-5-5",
    "/x",
    fake(remote("https://github.com/them/x")),
    env,
  );
  expect(note).toContain("AI policy");
  expect(note).toContain("`dotclaude:contribute`");
  expect(note).not.toContain("noreply@anthropic.com");
});

test("gitNote reads the organizations only when the login does not own the remote", () => {
  const asked = [];
  const run = (argv) => {
    asked.push(argv[1]);
    return fake(remote("https://github.com/org/x"), "me", "org\n")(argv);
  };
  // The settings files are missing, so Claude Code sends its own lines.
  expect(gitNote("claude-opus-5-5", "/x", run, env)).toBeNull();
  expect(asked).toEqual(["remote", "config", "api"]);
  asked.length = 0;
  gitNote(
    "x",
    "/x",
    (argv) => {
      asked.push(argv[1]);
      return fake(remote("https://github.com/me/x"))(argv);
    },
    env,
  );
  expect(asked).toEqual(["remote", "config"]);
});
