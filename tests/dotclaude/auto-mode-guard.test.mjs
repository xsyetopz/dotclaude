// The classic auto-mode hook of `hooks/auto-mode-guard.mjs`, with commands as strings.
// No command runs: `run` is a stub that answers `gh` calls from a table.

import { expect, test } from "bun:test";
import { decide } from "../../plugins/dotclaude/hooks/auto-mode-guard.mjs";

const env = { CLAUDE_PROJECT_DIR: "/w/app", HOME: "/h", TMPDIR: "/var/tmp/me" };
const payload = (command, mode = "auto") => ({
  session_id: "s1",
  cwd: "/w/app",
  permission_mode: mode,
  tool_name: "Bash",
  tool_input: { command },
});
const fresh = () => ({ seen: [], owners: null });
const LOGIN = "gh config get user -h github.com";
const POLICY = (repo) =>
  `gh api -H Accept: application/vnd.github.raw+json repos/${repo}/contents/CLAUDE.md`;
const stub = (table) => (argv) => table[argv.join(" ")] ?? null;

test("in auto mode, a recursive rm outside the project asks", async () => {
  const out = await decide(payload("rm -r ~/victim"), env, fresh(), stub({}));
  expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  expect(out.hookSpecificOutput.permissionDecisionReason).toContain(
    "`~/victim`",
  );
});

test("in auto mode, a recursive rm in the project or a temp folder gives no output", async () => {
  for (const command of [
    "rm -rf ./build",
    "rm -rf /tmp/x",
    "rm -rf /var/tmp/me/x",
  ])
    expect(
      await decide(payload(command), env, fresh(), stub({})),
    ).toBeUndefined();
});

test("in each other mode, the script gives no output", async () => {
  for (const mode of ["default", "acceptEdits", "plan", "dontAsk"])
    expect(
      await decide(payload("rm -r ~/victim", mode), env, fresh(), stub({})),
    ).toBeUndefined();
});

test("the policy ask comes once for each session, through the saved state", async () => {
  const run = stub({
    [LOGIN]: "me\n",
    [POLICY("other/lib")]: "No AI pull requests.",
  });
  const state = fresh();
  const first = await decide(
    payload("gh repo view other/lib"),
    env,
    state,
    run,
  );
  expect(first.hookSpecificOutput.permissionDecisionReason).toContain(
    "No AI pull requests.",
  );
  expect(state.seen).toEqual(["other/lib"]);
  expect(state.owners).toEqual(["me"]);
  const saved = JSON.parse(JSON.stringify(state));
  expect(
    await decide(payload("gh repo view other/lib"), env, saved, run),
  ).toBeUndefined();
});

test("a repository of the user gives no output", async () => {
  const run = stub({ [LOGIN]: "me\n", [POLICY("me/app")]: "Rules of my own." });
  expect(
    await decide(payload("gh repo view me/app"), env, fresh(), run),
  ).toBeUndefined();
});
