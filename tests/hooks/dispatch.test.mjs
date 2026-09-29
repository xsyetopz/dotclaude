// hooks/dispatch.mjs: matchers, output merge, fail-open per action, and
// exit code 2. Commands are plain strings here; nothing is executed.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { matches, merge } from "../../hooks/dispatch.mjs";
import {
  data,
  edit,
  HOOKS,
  noAccount,
  repo,
  session,
} from "../support/hooks.mjs";

function dispatch(args, input) {
  const res = spawnSync("bun", [path.join(HOOKS, "dispatch.mjs"), ...args], {
    input: JSON.stringify({ cwd: repo, ...input }),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: data,
      CLAUDE_PROJECT_DIR: repo,
      CLAUDE_CONFIG_DIR: noAccount,
      ANTHROPIC_API_KEY: "",
    },
  });
  return {
    code: res.status,
    stderr: res.stderr,
    out: res.stdout ? JSON.parse(res.stdout) : null,
  };
}

const pre = (decision, reason, extra = {}) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: decision,
    permissionDecisionReason: reason,
    ...extra,
  },
});

test("matchers: star, exact name, and alternation", () => {
  expect(matches("*", "Anything")).toBe(true);
  expect(matches("Bash", "Bash")).toBe(true);
  expect(matches("Bash", "BashOutput")).toBe(false);
  expect(matches("Bash|Read", "Read")).toBe(true);
  expect(matches("Bash|Read", undefined)).toBe(false);
});

test("merge: one output passes through unchanged", () => {
  const one = pre("ask", "why");
  expect(merge([one])).toBe(one);
  expect(merge([])).toBeUndefined();
});

test("merge: deny beats ask beats allow, with the winner's reason", () => {
  const out = merge([
    pre("allow", "a", { updatedInput: { command: "x" } }),
    pre("ask", "b"),
    pre("deny", "c"),
    pre("deny", "d"),
  ]).hookSpecificOutput;
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toBe("c");
  expect(out.updatedInput).toBeUndefined();
});

test("merge: rewritten input stays with an allow that wins", () => {
  const out = merge([
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "n",
      },
    },
    pre("allow", "a", { updatedInput: { command: "x" } }),
  ]).hookSpecificOutput;
  expect(out.permissionDecision).toBe("allow");
  expect(out.updatedInput).toEqual({ command: "x" });
  expect(out.additionalContext).toBe("n");
});

test("merge: contexts, messages, and block reasons join in order", () => {
  const out = merge([
    {
      systemMessage: "m1",
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: "c1" },
    },
    { decision: "block", reason: "r1" },
    { decision: "block", reason: "r2", systemMessage: "m2" },
    { hookSpecificOutput: { hookEventName: "Stop", additionalContext: "c2" } },
  ]);
  expect(out.decision).toBe("block");
  expect(out.reason).toBe("r1\n\nr2");
  expect(out.systemMessage).toBe("m1\nm2");
  expect(out.hookSpecificOutput.additionalContext).toBe("c1\n\nc2");
});

test("merge: continue false wins with its stop reason", () => {
  const out = merge([
    { systemMessage: "x" },
    { continue: false, stopReason: "s" },
  ]);
  expect(out.continue).toBe(false);
  expect(out.stopReason).toBe("s");
});

test("an event runs only the actions whose matcher fits", () => {
  const input = {
    session_id: session(),
    hook_event_name: "PreToolUse",
    permission_mode: "default",
  };
  const bash = dispatch(["PreToolUse"], {
    ...input,
    tool_name: "Bash",
    tool_input: { command: "rm -rf /" },
  });
  expect(bash.code).toBe(0);
  expect(bash.out.hookSpecificOutput.permissionDecision).toBe("deny");
  // The same text as a Read path reaches no Bash guard.
  const read = dispatch(["PreToolUse"], {
    ...input,
    tool_name: "Read",
    tool_input: { file_path: path.join(repo, "rm -rf") },
  });
  expect(read.code).toBe(0);
  expect(read.out?.hookSpecificOutput?.permissionDecision).toBeUndefined();
});

test("an action that throws does not stop the other actions", () => {
  const sid = session();
  edit(sid);
  const res = dispatch(
    [
      "--only",
      "../tests/fixtures/hooks/throws.mjs",
      "stop/require-verification.mjs",
    ],
    {
      session_id: sid,
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Done.",
    },
  );
  expect(res.code).toBe(0);
  expect(res.stderr).toContain("hook error in");
  expect(res.out.decision).toBe("block");
});

test("actions run at the same time and merge in table order", () => {
  const res = dispatch(
    [
      "--only",
      "../tests/fixtures/hooks/emits-late.mjs",
      "../tests/fixtures/hooks/emits-now.mjs",
    ],
    { session_id: session(), hook_event_name: "Stop" },
  );
  expect(res.code).toBe(0);
  expect(res.out.systemMessage).toBe("[dotclaude] late\n[dotclaude] now");
});

test("exit code 2 from an action reaches Claude Code through stderr", () => {
  const sid = session();
  edit(sid);
  const res = dispatch(["TaskCompleted"], {
    session_id: sid,
    hook_event_name: "TaskCompleted",
    task_id: "1",
    task_subject: "Fix the parser",
  });
  expect(res.code).toBe(2);
  expect(res.stderr).toContain("is not verified");
});

test("an unknown event runs nothing and succeeds", () => {
  const res = dispatch(["NoSuchEvent"], {});
  expect(res).toEqual({ code: 0, stderr: "", out: null });
});
