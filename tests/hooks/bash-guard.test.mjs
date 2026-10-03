// Bash guard hook decisions, run end-to-end as Claude Code runs hooks.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { data, HOOKS, hook, repo } from "../support/hooks.mjs";

test("bash guard emits ask and deny decisions, and nothing for safe commands", () => {
  const ask = hook("pre-tool-use/block-destructive-commands.mjs", {
    tool_name: "Bash",
    tool_input: { command: "git push --force" },
  });
  expect(ask.hookSpecificOutput.permissionDecision).toBe("ask");
  // The ask reason is the user's permission prompt: no tag there.
  expect(ask.hookSpecificOutput.permissionDecisionReason).not.toContain(
    "[dotclaude]",
  );
  const deny = hook("pre-tool-use/block-destructive-commands.mjs", {
    tool_name: "Bash",
    tool_input: { command: "rm -rf ~" },
  });
  expect(deny.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(deny.hookSpecificOutput.permissionDecisionReason).toStartWith(
    "[dotclaude]",
  );
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
      { CLAUDE_PLUGIN_OPTION_GUARD_ASK_IN_AUTO: "true" },
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
  const env = { CLAUDE_PLUGIN_OPTION_GUARD_BASH: "false" };
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
    "apply-statusline",
    "install-managed",
    "migrate",
  ]) {
    const out = bash(
      `bun "/p/skills/setup/scripts/${script}.mjs" --scope user --apply`,
    );
    expect(out.permissionDecision, script).toBe("ask");
    expect(out.permissionDecisionReason).toContain(`${script}.mjs --apply`);
  }
  // Another project's migration script is not a settings write.
  expect(bash("bun scripts/migrate.mjs --apply")).toBeNull();
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

// No check on the words of the prompt decides consent, so the ask stays
// also when the user asked to remove tests.
test("a Bash write that removes assertions asks, also when the user asked for it", () => {
  fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "tests", "w.test.mjs"),
    'test("w", () => expect(1).toBe(1));\n',
  );
  const transcript = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-t-")),
    "t.jsonl",
  );
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      type: "user",
      message: { content: "Remove the flaky tests for the old flag." },
    }),
  );
  const decision =
    hook("pre-tool-use/block-destructive-commands.mjs", {
      tool_name: "Bash",
      tool_input: {
        command: "cat > tests/w.test.mjs <<'EOF'\ntest(\"w\", () => {});\nEOF",
      },
      transcript_path: transcript,
    })?.hookSpecificOutput.permissionDecision ?? null;
  expect(decision).toBe("ask");
});

test("an Edit that removes assertions asks, also when the user asked for it", () => {
  const file = path.join(repo, "tests", "e.test.mjs");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const transcript = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-t-")),
    "t.jsonl",
  );
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      type: "user",
      message: { content: "Remove the flaky tests." },
    }),
  );
  const out = hook("pre-tool-use/confirm-risky-edits.mjs", {
    tool_name: "Edit",
    tool_input: {
      file_path: file,
      old_string: "test(() => expect(1).toBe(1));",
      new_string: "test();",
    },
    transcript_path: transcript,
  })?.hookSpecificOutput;
  expect(out.permissionDecision).toBe("ask");
  expect(out.permissionDecisionReason).toMatch(
    /assertion\(s\) from a test file/,
  );
});

test("each guard decision adds one verdict log line with a bounded target", () => {
  const log = path.join(data, "verdicts.jsonl");
  const lines = () =>
    fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
      : [];
  const before = lines().length;
  const long = `git push --force origin ${"x".repeat(400)}`;
  hook("pre-tool-use/block-destructive-commands.mjs", {
    session_id: "log-1",
    tool_name: "Bash",
    tool_input: { command: long },
  });
  const after = lines();
  expect(after.length).toBe(before + 1);
  const entry = JSON.parse(after.at(-1));
  expect(entry).toMatchObject({ session: "log-1", level: "ask", tool: "Bash" });
  expect(entry.target.length).toBeLessThanOrEqual(200);
  expect(after.at(-1)).not.toContain("x".repeat(201));
  hook("pre-tool-use/block-destructive-commands.mjs", {
    session_id: "log-1",
    tool_name: "Bash",
    tool_input: { command: "bun test" },
  });
  expect(lines().length, "a command with no finding adds no line").toBe(
    before + 1,
  );
});

test("an ask the user approved is not asked again in that session", () => {
  const pre = (sid, command, id) =>
    hook("pre-tool-use/block-destructive-commands.mjs", {
      session_id: sid,
      tool_name: "Bash",
      tool_use_id: id,
      tool_input: { command },
    })?.hookSpecificOutput.permissionDecision ?? null;
  const post = (sid, command, id) =>
    hook("post-tool-use/record-edits-and-checks.mjs", {
      session_id: sid,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: id,
      tool_input: { command },
      tool_response: { stdout: "", stderr: "" },
    });
  const push = "git push --force origin feature";
  expect(pre("mem-1", push, "t1")).toBe("ask");
  expect(pre("mem-1", push, "t2"), "not approved yet").toBe("ask");
  post("mem-1", push, "t2");
  expect(pre("mem-1", push, "t3"), "approved once").toBe(null);
  expect(pre("mem-1", `${push}-2`, "t4"), "another target").toBe("ask");
  expect(pre("mem-2", push, "t5"), "a new session").toBe("ask");
  // A deny is never remembered.
  expect(pre("mem-1", "rm -rf ~", "t6")).toBe("deny");
  post("mem-1", "rm -rf ~", "t6");
  expect(pre("mem-1", "rm -rf ~", "t7")).toBe("deny");
});

test("an approved edit ask covers only the same edit", () => {
  const file_path = path.join(repo, ".claude", "settings.local.json");
  const input = (n) => ({
    file_path,
    old_string: '"a": 1',
    new_string: `"a": ${n}`,
  });
  const pre = (n, id) =>
    hook("pre-tool-use/confirm-risky-edits.mjs", {
      session_id: "mem-edit",
      tool_name: "Edit",
      tool_use_id: id,
      tool_input: input(n),
    })?.hookSpecificOutput.permissionDecision ?? null;
  expect(pre(2, "e1")).toBe("ask");
  hook("post-tool-use/record-edits-and-checks.mjs", {
    session_id: "mem-edit",
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_use_id: "e1",
    tool_input: input(2),
  });
  expect(pre(2, "e2"), "the same edit").toBe(null);
  expect(pre(3, "e3"), "another edit to the file").toBe("ask");
});

test("a dev server passes only with `run_in_background`", () => {
  const decision = (tool_input) =>
    hook("pre-tool-use/block-destructive-commands.mjs", {
      tool_name: "Bash",
      tool_input,
    })?.hookSpecificOutput.permissionDecision ?? null;
  expect(decision({ command: "npm run dev" })).toBe("deny");
  expect(decision({ command: "npm run dev", run_in_background: true })).toBe(
    null,
  );
});
