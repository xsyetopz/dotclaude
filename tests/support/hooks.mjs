// Shared helpers for the hook end-to-end tests: run each hook action through
// `hooks/dispatch.mjs` with JSON on stdin, as Claude Code does. Hooks only
// read their input and write the ledger under a temp data dir.

import { expect } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOOKS = path.resolve(import.meta.dirname, "../../hooks");
export const data = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-data-"));
export const repo = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-repo-")),
);
execFileSync("git", ["init", "-q", repo]);
// A test command, because the verify gate passes in a project with none.
fs.writeFileSync(path.join(repo, "justfile"), "test:\n    bun test\n");
// No cached Claude account, so the machine running the tests does not
// decide the plan.
export const noAccount = fs.mkdtempSync(
  path.join(os.tmpdir(), "dotclaude-home-"),
);

const DISPATCH = path.join(HOOKS, "dispatch.mjs");

export function hook(script, input, env = {}) {
  const res = spawnSync("bun", [DISPATCH, "--only", script], {
    input: JSON.stringify({ cwd: repo, ...input }),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: data,
      CLAUDE_PROJECT_DIR: repo,
      CLAUDE_CODE_DISABLE_FAST_MODE: "1",
      CLAUDE_CONFIG_DIR: noAccount,
      ANTHROPIC_API_KEY: "",
      ...env,
    },
  });
  expect(res.status, res.stderr).toBe(0);
  return res.stdout ? JSON.parse(res.stdout) : null;
}

let n = 0;
export const session = () => `s${Date.now()}-${n++}`;
export const edit = (sid, file = "src/app.js") =>
  hook("post-tool-use/record-edits-and-checks.mjs", {
    session_id: sid,
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: path.join(repo, file) },
  });
export const checkRun = (sid, command, ok = true, stdout = "") =>
  ok
    ? hook("post-tool-use/record-edits-and-checks.mjs", {
        session_id: sid,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command },
        tool_response: { stdout, stderr: "" },
      })
    : hook("post-tool-use/record-edits-and-checks.mjs", {
        session_id: sid,
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command },
        error: "Exit code 1\nFAIL",
      });
// A Stop gate sends Claude back with `additionalContext`: Claude Code shows
// it to the user as "Stop hook feedback", not as an error.
/** The event name of a Stop gate's feedback, or undefined for no feedback. */
export const blocked = (out) =>
  out?.hookSpecificOutput?.additionalContext
    ? out.hookSpecificOutput.hookEventName
    : undefined;
/** The text of a Stop gate's feedback. */
export const feedback = (out) => out?.hookSpecificOutput?.additionalContext;
export const stop = (sid, message = "Done.", extra = {}) =>
  hook("stop/require-verification.mjs", {
    session_id: sid,
    hook_event_name: "Stop",
    stop_hook_active: false,
    last_assistant_message: message,
    ...extra,
  });

export const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// Runs a hook with its own plugin data directory per call unless the
// caller passes CLAUDE_PLUGIN_DATA, for state that must not leak between calls.
export function isolatedHook(script, input, env = {}) {
  const res = spawnSync("bun", [DISPATCH, "--only", script], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: tmp("dotclaude-data-"),
      ...env,
    },
  });
  expect(res.status, res.stderr).toBe(0);
  return res.stdout ? JSON.parse(res.stdout) : null;
}
