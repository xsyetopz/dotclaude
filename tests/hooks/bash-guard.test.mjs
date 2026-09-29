// Bash guard hook decisions, run end-to-end as Claude Code runs hooks.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

test("settings writes ask in auto mode, where the classifier would deny them", () => {
  const decision = (input) =>
    hook("pre-tool-use/block-destructive-commands.mjs", {
      permission_mode: "auto",
      ...input,
    })?.hookSpecificOutput ?? null;
  const bash = (command) =>
    decision({ tool_name: "Bash", tool_input: { command } });
  for (const script of [
    "apply-settings",
    "apply-claude-md",
    "apply-launcher",
    "apply-statusline",
    "install-managed",
  ]) {
    const out = bash(`bun "/p/scripts/${script}.mjs" --scope user --apply`);
    expect(out.permissionDecision, script).toBe("ask");
    expect(out.permissionDecisionReason).toContain(`${script}.mjs --apply`);
  }
  expect(
    bash(
      'SUDO_ASKPASS=/p/askpass.sh sudo -A "$(command -v bun)" /p/scripts/install-managed.mjs --apply',
    ).permissionDecision,
  ).toBe("ask");
  expect(
    bash(
      "jq '.permissions.deny -= [\"X\"]' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json",
    ).permissionDecision,
  ).toBe("ask");
  expect(bash('bun "/p/scripts/apply-settings.mjs" --scope user')).toBe(null);
  expect(bash("jq . ~/.claude/settings.json")).toBe(null);
  const edit = (file_path) =>
    hook("pre-tool-use/confirm-risky-edits.mjs", {
      permission_mode: "auto",
      tool_name: "Edit",
      tool_input: { file_path, old_string: '"a": 1', new_string: '"a": 2' },
    })?.hookSpecificOutput.permissionDecision ?? null;
  expect(edit(path.join(repo, ".claude", "settings.local.json"))).toBe("ask");
  expect(
    edit(
      "/Library/Application Support/ClaudeCode/managed-settings.d/50-x.json",
    ),
  ).toBe("ask");
  expect(edit(path.join(repo, "config", "settings.json"))).toBe(null);
});

test("a Bash write that removes assertions asks unless the user asked for it", () => {
  fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "tests", "w.test.mjs"),
    'test("w", () => expect(1).toBe(1));\n',
  );
  const transcript = (prompt) => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-t-")),
      "t.jsonl",
    );
    fs.writeFileSync(
      file,
      JSON.stringify({ type: "user", message: { content: prompt } }),
    );
    return file;
  };
  const decision = (prompt) =>
    hook("pre-tool-use/block-destructive-commands.mjs", {
      tool_name: "Bash",
      tool_input: {
        command: "cat > tests/w.test.mjs <<'EOF'\ntest(\"w\", () => {});\nEOF",
      },
      transcript_path: transcript(prompt),
    })?.hookSpecificOutput.permissionDecision ?? null;
  expect(decision("Tidy the helper.")).toBe("ask");
  expect(decision("Remove the flaky tests for the old flag.")).toBe(null);
});
