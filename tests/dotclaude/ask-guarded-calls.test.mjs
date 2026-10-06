import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { askReason } from "../../plugins/dotclaude/hooks/pre-tool-use/ask-guarded-calls.mjs";

const env = { HOME: "/home/u", CLAUDE_PROJECT_DIR: "/work/app" };
const bash = (command) => ({
  tool_name: "Bash",
  tool_input: { command },
  cwd: "/work/app",
});

test("a guarded Bash command gives its reason", () => {
  expect(askReason(bash("codegraph init -y"), env)).toContain(
    "`codegraph init -y`",
  );
  expect(askReason(bash("git branch -D old"), env)).toContain(
    "`git branch -D old`",
  );
});

test("a safe Bash command gives no reason", () => {
  expect(askReason(bash("git status"), env)).toBeUndefined();
  expect(askReason(bash("codegraph sync"), env)).toBeUndefined();
});

test("an edit of Claude settings gives a reason", () => {
  const data = {
    tool_name: "Edit",
    tool_input: {
      file_path: "/work/app/.claude/settings.json",
      old_string: "a",
      new_string: "b",
    },
  };
  expect(askReason(data, env)).toContain("Claude Code settings");
});

test("a PublishPlugin call gives a reason", () => {
  const data = {
    tool_name: "PublishPlugin",
    tool_input: { path: "/work/app" },
  };
  expect(askReason(data, env)).toContain("library of the organization");
  expect(
    askReason(data, {
      ...env,
      CLAUDE_PLUGIN_OPTION_GUARD_BASH: "false",
      CLAUDE_PLUGIN_OPTION_GUARD_EDIT: "false",
    }),
  ).toContain("publishes a plugin");
});

test("the guard options turn the asks off", () => {
  expect(
    askReason(bash("git reset --hard"), {
      ...env,
      CLAUDE_PLUGIN_OPTION_GUARD_BASH: "false",
    }),
  ).toBeUndefined();
  const data = {
    tool_name: "Write",
    tool_input: { file_path: "/work/app/.claude/settings.json", content: "" },
  };
  expect(
    askReason(data, { ...env, CLAUDE_PLUGIN_OPTION_GUARD_EDIT: "false" }),
  ).toBeUndefined();
});

test("the script prints an ask decision, and nothing for a safe call", () => {
  const script = join(
    import.meta.dir,
    "../../plugins/dotclaude/hooks/pre-tool-use/ask-guarded-calls.mjs",
  );
  const run = (data) =>
    spawnSync("bun", [script], {
      input: JSON.stringify(data),
      encoding: "utf8",
      env: { ...process.env, ...env },
    }).stdout;
  const out = JSON.parse(run(bash("git push --force")));
  expect(out.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
  });
  expect(out.hookSpecificOutput.permissionDecisionReason).toContain(
    "`git push --force`",
  );
  expect(run(bash("ls"))).toBe("");
});
