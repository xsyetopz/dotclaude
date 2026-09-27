// Bash guard hook decisions, run end-to-end as Claude Code runs hooks.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { HOOKS, hook, repo } from "../support/hooks.mjs";

test("bash guard emits ask and deny decisions, and nothing for safe commands", () => {
  const ask = hook("pre-tool-use/block-destructive-commands.mjs", {
    tool_name: "Bash",
    tool_input: { command: "git push --force" },
  });
  expect(ask.hookSpecificOutput.permissionDecision).toBe("ask");
  const deny = hook("pre-tool-use/block-destructive-commands.mjs", {
    tool_name: "Bash",
    tool_input: { command: "rm -rf ~" },
  });
  expect(deny.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(
    hook("pre-tool-use/block-destructive-commands.mjs", {
      tool_name: "Bash",
      tool_input: { command: "bun test" },
    }),
  ).toBe(null);
});

test("recoverable findings ask in default mode and stay quiet in auto mode", () => {
  const warn = {
    tool_name: "Bash",
    tool_input: { command: "find . -name '*.log' -delete" },
  };
  const decision = (input, env) =>
    hook("pre-tool-use/block-destructive-commands.mjs", input, env)
      ?.hookSpecificOutput.permissionDecision ?? null;
  expect(decision({ ...warn, permission_mode: "default" })).toBe("ask");
  expect(decision({ ...warn, permission_mode: "auto" })).toBe(null);
  expect(
    decision(
      { ...warn, permission_mode: "auto" },
      { CLAUDE_PLUGIN_OPTION_ASK_IN_AUTO_MODE: "true" },
    ),
  ).toBe("ask");
  expect(
    decision({
      tool_name: "Bash",
      tool_input: { command: "git push --force" },
      permission_mode: "auto",
    }),
    "irreversible commands still ask in auto mode",
  ).toBe("ask");
  const lockfile = {
    tool_name: "Edit",
    tool_input: {
      file_path: path.join(repo, "package-lock.json"),
      old_string: "a",
      new_string: "b",
    },
  };
  expect(
    hook("pre-tool-use/confirm-risky-edits.mjs", {
      ...lockfile,
      permission_mode: "auto",
    }),
  ).toBe(null);
  expect(
    hook("pre-tool-use/confirm-risky-edits.mjs", lockfile).hookSpecificOutput
      .permissionDecision,
  ).toBe("ask");
});

test("bash guard off still enforces the model lock", () => {
  const env = { CLAUDE_PLUGIN_OPTION_BASH_GUARD: "false" };
  expect(
    hook(
      "pre-tool-use/block-destructive-commands.mjs",
      { tool_input: { command: "git push --force" } },
      env,
    ),
  ).toBe(null);
  const out = hook(
    "pre-tool-use/block-destructive-commands.mjs",
    { tool_input: { command: "claude --model claude-opus-4-1 -p hi" } },
    env,
  );
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("malformed input fails open", () => {
  const res = spawnSync(
    "bun",
    [path.join(HOOKS, "pre-tool-use/block-destructive-commands.mjs")],
    { input: "not json", encoding: "utf8" },
  );
  expect(res.status).toBe(0);
  expect(res.stdout).toBe("");
});
