// End-to-end: run each hook script with JSON on stdin, as Claude Code does.
// Hooks only read their input and write the ledger under a temp data dir.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const HOOKS = path.resolve(import.meta.dirname, "../hooks");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-data-"));
const repo = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-repo-")),
);
execFileSync("git", ["init", "-q", repo]);

function hook(script, input, env = {}) {
  const res = spawnSync("bun", [path.join(HOOKS, script)], {
    input: JSON.stringify({ cwd: repo, ...input }),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: data,
      CLAUDE_PROJECT_DIR: repo,
      CLAUDE_CODE_DISABLE_FAST_MODE: "1",
      ...env,
    },
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout ? JSON.parse(res.stdout) : null;
}

let n = 0;
const session = () => `s${Date.now()}-${n++}`;
const edit = (sid, file = "src/app.js") =>
  hook("post-tool-use/record-edits-and-checks.mjs", {
    session_id: sid,
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: path.join(repo, file) },
  });
const checkRun = (sid, command, ok = true, stdout = "") =>
  ok
    ? hook("post-tool-use/record-edits-and-checks.mjs", {
        session_id: sid,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command },
        tool_response: { stdout, stderr: "" },
      })
    : hook("post-tool-use-failure/record-failed-checks.mjs", {
        session_id: sid,
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command },
        error: "Exit code 1\nFAIL",
      });
const stop = (sid, message = "Done.", extra = {}) =>
  hook("stop/require-verification.mjs", {
    session_id: sid,
    hook_event_name: "Stop",
    stop_hook_active: false,
    last_assistant_message: message,
    ...extra,
  });

test("bash guard emits ask and deny decisions, and nothing for safe commands", () => {
  const ask = hook("pre-tool-use/block-destructive-commands.mjs", {
    tool_name: "Bash",
    tool_input: { command: "git push --force" },
  });
  assert.equal(ask.hookSpecificOutput.permissionDecision, "ask");
  const deny = hook("pre-tool-use/block-destructive-commands.mjs", {
    tool_name: "Bash",
    tool_input: { command: "rm -rf ~" },
  });
  assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(
    hook("pre-tool-use/block-destructive-commands.mjs", {
      tool_name: "Bash",
      tool_input: { command: "bun test" },
    }),
    null,
  );
});

test("recoverable findings ask in default mode and stay quiet in auto mode", () => {
  const warn = {
    tool_name: "Bash",
    tool_input: { command: "find . -name '*.log' -delete" },
  };
  const decision = (input, env) =>
    hook("pre-tool-use/block-destructive-commands.mjs", input, env)
      ?.hookSpecificOutput.permissionDecision ?? null;
  assert.equal(decision({ ...warn, permission_mode: "default" }), "ask");
  assert.equal(decision({ ...warn, permission_mode: "auto" }), null);
  assert.equal(
    decision(
      { ...warn, permission_mode: "auto" },
      { CLAUDE_PLUGIN_OPTION_ASK_IN_AUTO_MODE: "true" },
    ),
    "ask",
  );
  assert.equal(
    decision({
      tool_name: "Bash",
      tool_input: { command: "git push --force" },
      permission_mode: "auto",
    }),
    "ask",
    "irreversible commands still ask in auto mode",
  );
  const lockfile = {
    tool_name: "Edit",
    tool_input: {
      file_path: path.join(repo, "package-lock.json"),
      old_string: "a",
      new_string: "b",
    },
  };
  assert.equal(
    hook("pre-tool-use/confirm-risky-edits.mjs", {
      ...lockfile,
      permission_mode: "auto",
    }),
    null,
  );
  assert.equal(
    hook("pre-tool-use/confirm-risky-edits.mjs", lockfile).hookSpecificOutput
      .permissionDecision,
    "ask",
  );
});

test("bash guard off still enforces the model lock", () => {
  const env = { CLAUDE_PLUGIN_OPTION_BASH_GUARD: "false" };
  assert.equal(
    hook(
      "pre-tool-use/block-destructive-commands.mjs",
      { tool_input: { command: "git push --force" } },
      env,
    ),
    null,
  );
  const out = hook(
    "pre-tool-use/block-destructive-commands.mjs",
    { tool_input: { command: "claude --model claude-sonnet-5 -p hi" } },
    env,
  );
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
});

test("malformed input fails open", () => {
  const res = spawnSync(
    "bun",
    [path.join(HOOKS, "pre-tool-use/block-destructive-commands.mjs")],
    { input: "not json", encoding: "utf8" },
  );
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");
});

test("stop gate blocks once after an unverified edit", () => {
  const sid = session();
  edit(sid);
  const first = stop(sid);
  assert.equal(first.decision, "block");
  assert.match(first.reason, /src\/app\.js/);
  assert.equal(stop(sid), null, "same edit state does not block twice");
});

test("stop gate counts files written through Bash as edits", () => {
  const sid = session();
  checkRun(sid, "bun test");
  checkRun(sid, "cat > src/gen.js <<'EOF'\nexport const x = 1;\nEOF");
  const out = stop(sid);
  assert.equal(out?.decision, "block");
  assert.match(out.reason, /src\/gen\.js/);
  const sid2 = session();
  checkRun(sid2, "sed -n 1,5p src/gen.js > /tmp/view.txt && bun test");
  assert.equal(stop(sid2), null, "a write outside the project is not an edit");
});

test("inline scripts that write only scratch files are not edits", () => {
  const sid = session();
  const bash = (command) =>
    hook("post-tool-use/record-edits-and-checks.mjs", {
      session_id: sid,
      agent_id: "a2",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command },
      tool_response: { stdout: "", stderr: "" },
    });
  bash(
    "python3 - <<'EOF'\nimport json\njson.dump({}, open('/tmp/dotclaude-scratch/dec.json', 'w'))\nEOF",
  );
  assert.equal(
    stop(sid, "Done.", { hook_event_name: "SubagentStop", agent_id: "a2" }),
    null,
  );
  bash("python3 - <<'EOF'\nopen('src/app.py', 'w').write('x = 2')\nEOF");
  assert.equal(
    stop(sid, "Done.", { hook_event_name: "SubagentStop", agent_id: "a2" })
      ?.decision,
    "block",
  );
});

test("subagent stop checks the subagent's own ledger", () => {
  const sid = session();
  hook("post-tool-use/record-edits-and-checks.mjs", {
    session_id: sid,
    agent_id: "a1",
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: path.join(repo, "src/worker.js") },
  });
  assert.equal(stop(sid), null, "the main session made no edit");
  const out = stop(sid, "Done.", {
    hook_event_name: "SubagentStop",
    agent_id: "a1",
  });
  assert.equal(out?.decision, "block");
  assert.match(out.reason, /src\/worker\.js/);
});

test("a multi-file sd records every file as this session's edit", () => {
  const sid = session();
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  for (const f of ["a.js", "b.js", "c.js"])
    fs.writeFileSync(path.join(repo, "src", f), "old\n");
  checkRun(sid, "sd old new src/a.js src/b.js src/c.js");
  const ledger = JSON.parse(
    fs.readFileSync(path.join(data, "sessions", `${sid}.json`), "utf8"),
  );
  assert.deepEqual(ledger.edited, ["src/a.js", "src/b.js", "src/c.js"]);
});

test("stop gate passes after a passing check", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "bun test");
  assert.equal(stop(sid), null);
});

test("stop gate accepts a reply that says the change is unverified", () => {
  const sid = session();
  edit(sid);
  assert.equal(
    stop(
      sid,
      "Changed the parser. I haven't run the tests; there is no test runner configured.",
    ),
    null,
  );
});

test("stop gate honors stop_hook_active and running background work", () => {
  const sid = session();
  edit(sid);
  assert.equal(stop(sid, "Done.", { stop_hook_active: true }), null);
  assert.equal(
    stop(sid, "Done.", {
      background_tasks: [{ id: "t", type: "shell", status: "running" }],
    }),
    null,
  );
});

test("stop gate catches a failed check reported as passing", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "pytest", false);
  const out = stop(sid, "All tests pass now.");
  assert.equal(out.decision, "block");
  assert.match(out.reason, /pytest/);
});

test("a piped check whose output shows failures counts as failed", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "pytest -q | tail -5", true, "3 passed, 2 failed in 0.4s");
  assert.equal(stop(sid, "Tests pass.").decision, "block");
});

test("zero failures in output counts as passing", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "pytest -q | tail -5", true, "5 passed, 0 failed in 0.4s");
  assert.equal(stop(sid, "Tests pass."), null);
});

test("doc edits do not trip the stop gate", () => {
  const sid = session();
  edit(sid, "README.md");
  assert.equal(stop(sid), null);
});

test("stop gate flags a pass claim when nothing ran", () => {
  const sid = session();
  assert.equal(stop(sid, "All tests pass.").decision, "block");
});

test("compaction carry-over restores prompts and last check", () => {
  const sid = session();
  const transcript = path.join(data, `${sid}.jsonl`);
  const lines = [
    {
      type: "user",
      origin: { kind: "human" },
      message: { content: "Add retry to the fetch client" },
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", content: "ok" }] },
    },
    {
      type: "user",
      isMeta: true,
      message: { content: "<system-reminder>x</system-reminder>" },
    },
    {
      type: "attachment",
      attachment: {
        type: "queued_command",
        humanTurn: true,
        prompt: "Keep the public API unchanged",
      },
    },
    {
      type: "user",
      origin: { kind: "task-notification" },
      message: { content: "<task-notification>done</task-notification>" },
    },
  ];
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join("\n"));
  checkRun(sid, "bun test");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "mine.js"), "x\n");
  fs.writeFileSync(path.join(repo, "src", "users.js"), "y\n");
  edit(sid, "src/mine.js");
  checkRun(sid, "bun test");
  hook("pre-compact/save-recent-prompts.mjs", {
    session_id: sid,
    hook_event_name: "PreCompact",
    transcript_path: transcript,
  });
  const out = hook("session-start/restore-context-after-compact.mjs", {
    session_id: sid,
    hook_event_name: "SessionStart",
    source: "compact",
    transcript_path: transcript,
  });
  const text = out.hookSpecificOutput.additionalContext;
  assert.match(
    text,
    /1\. Add retry to the fetch client\n2\. Keep the public API unchanged/,
  );
  assert.doesNotMatch(text, /task-notification|system-reminder/);
  assert.match(text, /`bun test` passed/);
  assert.match(
    text,
    /this session or its subagents edited: [^\n]*src\/mine\.js/,
  );
  assert.match(text, /not recorded as edited[^\n]*src\/users\.js/);
  assert.doesNotMatch(
    text.match(/not recorded as edited[^\n]*/)[0],
    /src\/mine\.js/,
  );
  assert.ok(text.length <= 2600);
});

test("session start warns about incomplete setup and notes a CodeGraph index", () => {
  const warn = hook(
    "session-start/warn-incomplete-setup.mjs",
    { hook_event_name: "SessionStart", source: "startup" },
    { CLAUDE_CODE_DISABLE_FAST_MODE: "" },
  );
  assert.match(warn.systemMessage, /fast mode/);
  const current = {
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
    CLAUDE_CODE_EFFORT_LEVEL: "",
  };
  const start = (env) =>
    hook(
      "session-start/warn-incomplete-setup.mjs",
      { hook_event_name: "SessionStart", source: "startup" },
      { ...current, ...env },
    );
  assert.equal(start({}), null);
  assert.match(
    start({ ANTHROPIC_DEFAULT_HAIKU_MODEL: "" }).systemMessage,
    /out of date/,
  );
  assert.match(
    start({ CLAUDE_CODE_EFFORT_LEVEL: "max" }).systemMessage,
    /CLAUDE_CODE_EFFORT_LEVEL=max/,
  );
  fs.mkdirSync(path.join(repo, ".codegraph"), { recursive: true });
  const note = hook("session-start/note-codegraph-index.mjs", {
    hook_event_name: "SessionStart",
    source: "startup",
  });
  assert.match(note.hookSpecificOutput.additionalContext, /CodeGraph/);
  assert.equal(
    hook(
      "session-start/note-codegraph-index.mjs",
      { hook_event_name: "SessionStart", source: "startup" },
      { CLAUDE_PLUGIN_OPTION_CODEGRAPH_HINT: "false" },
    ),
    null,
  );
});

test("model lock denies disallowed subagent models and switches", () => {
  const unmapped = { ANTHROPIC_DEFAULT_SONNET_MODEL: "" };
  const agent = hook(
    "pre-tool-use/restrict-subagent-models.mjs",
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { model: "sonnet", prompt: "x" },
    },
    unmapped,
  );
  assert.equal(agent.hookSpecificOutput.permissionDecision, "deny");
  assert.match(
    agent.hookSpecificOutput.permissionDecisionReason,
    /mechanical-worker/,
  );
  assert.equal(
    hook(
      "pre-tool-use/restrict-subagent-models.mjs",
      {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: { model: "sonnet", prompt: "x" },
      },
      { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-5-5" },
    ),
    null,
    "the sonnet alias is allowed once the profile maps it to Opus 5.5",
  );
  for (const model of ["haiku", "claude-haiku-4-5"])
    assert.equal(
      hook(
        "pre-tool-use/restrict-subagent-models.mjs",
        {
          hook_event_name: "PreToolUse",
          tool_name: "Agent",
          tool_input: { model, prompt: "x" },
        },
        { ANTHROPIC_DEFAULT_HAIKU_MODEL: "" },
      ),
      null,
      model,
    );
  assert.equal(
    hook("pre-tool-use/restrict-subagent-models.mjs", {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { prompt: "x" },
    }),
    null,
  );
  assert.equal(
    hook("pre-tool-use/restrict-subagent-models.mjs", {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { model: "opus" },
    }),
    null,
  );
  assert.equal(
    hook("pre-model-switch/restrict-models.mjs", {
      hook_event_name: "PreModelSwitch",
      to_model: "claude-sonnet-5",
    }).decision,
    "block",
  );
  assert.equal(
    hook("pre-model-switch/restrict-models.mjs", {
      hook_event_name: "PreModelSwitch",
      to_model: "claude-fable-5-1",
    }),
    null,
  );
});

test("model lock blocks a settings change that enables fast mode", () => {
  const settings = path.join(data, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ fastMode: true }));
  assert.equal(
    hook("config-change/block-fast-mode.mjs", {
      hook_event_name: "ConfigChange",
      source: "user_settings",
      file_path: settings,
    }).decision,
    "block",
  );
  fs.writeFileSync(settings, JSON.stringify({ fastMode: false }));
  assert.equal(
    hook("config-change/block-fast-mode.mjs", {
      hook_event_name: "ConfigChange",
      source: "user_settings",
      file_path: settings,
    }),
    null,
  );
  fs.writeFileSync(settings, JSON.stringify({ fastMode: true }));
  assert.equal(
    hook(
      "config-change/block-fast-mode.mjs",
      {
        hook_event_name: "ConfigChange",
        source: "user_settings",
        file_path: settings,
      },
      { CLAUDE_PLUGIN_OPTION_MODEL_LOCK: "false" },
    ),
    null,
  );
});

test("subagent guidance is injected, skipped for the reviewer, and can be turned off", () => {
  const out = hook("subagent-start/inject-working-conventions.mjs", {
    hook_event_name: "SubagentStart",
    agent_id: "a1",
    agent_type: "general-purpose",
  });
  assert.equal(out.hookSpecificOutput.hookEventName, "SubagentStart");
  assert.match(out.hookSpecificOutput.additionalContext, /hypotheses/);
  assert.match(
    out.hookSpecificOutput.additionalContext,
    /final message is the only output delivered/,
  );
  assert.equal(
    hook("subagent-start/inject-working-conventions.mjs", {
      hook_event_name: "SubagentStart",
      agent_type: "dotclaude:codex-worker",
    }),
    null,
  );
  assert.ok(
    hook("subagent-start/inject-working-conventions.mjs", {
      hook_event_name: "SubagentStart",
      agent_type: "dotclaude:implementer",
    }),
  );
  assert.equal(
    hook("subagent-start/inject-working-conventions.mjs", {
      hook_event_name: "SubagentStart",
      agent_type: "dotclaude:code-reviewer",
    }),
    null,
  );
  assert.equal(
    hook(
      "subagent-start/inject-working-conventions.mjs",
      { hook_event_name: "SubagentStart", agent_type: "Explore" },
      { CLAUDE_PLUGIN_OPTION_SUBAGENT_GUIDANCE: "false" },
    ),
    null,
  );
});

test("codegraph prompt context runs for typed prompts only, when enabled", () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-bin-"));
  const fake = path.join(bin, "codegraph");
  fs.writeFileSync(fake, "#!/bin/sh\ncat >/dev/null\necho CODEGRAPH-CONTEXT\n");
  fs.chmodSync(fake, 0o755);
  fs.mkdirSync(path.join(repo, ".codegraph"), { recursive: true });
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    CLAUDE_PLUGIN_OPTION_CODEGRAPH_PROMPT_CONTEXT: "true",
  };
  const prompt = (text, extra = env) => {
    const res = spawnSync(
      "bun",
      [path.join(HOOKS, "user-prompt-submit/codegraph-context.mjs")],
      {
        input: JSON.stringify({ cwd: repo, prompt: text }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...extra },
      },
    );
    assert.equal(res.status, 0, res.stderr);
    return res.stdout.trim();
  };
  assert.equal(
    prompt("how does the parser split commands?"),
    "CODEGRAPH-CONTEXT",
  );
  assert.equal(
    prompt(
      "<task-notification>\n<task-id>t1</task-id>\n<result>done</result>\n</task-notification>",
    ),
    "",
  );
  assert.equal(
    prompt("[SYSTEM NOTIFICATION - NOT USER INPUT] agent finished"),
    "",
  );
  assert.equal(
    prompt("how does the parser split commands?", {
      ...env,
      CLAUDE_PLUGIN_OPTION_CODEGRAPH_PROMPT_CONTEXT: "false",
    }),
    "",
  );
});

test("Fable sessions get the Fable adjustments; Opus sessions get nothing", () => {
  const start = (model) =>
    hook("session-start/add-session-notes.mjs", {
      hook_event_name: "SessionStart",
      source: "startup",
      model,
    });
  assert.match(
    start("claude-fable-5-1").hookSpecificOutput.additionalContext,
    /fable_adjustments/,
  );
  assert.equal(start("claude-opus-5-5"), null);
});

test("non-default browser options reach Claude through the session notes", () => {
  const notes = (env) =>
    hook(
      "session-start/add-session-notes.mjs",
      {
        hook_event_name: "SessionStart",
        source: "startup",
        model: "claude-opus-5-5",
      },
      env,
    );
  assert.equal(notes({}), null, "defaults add nothing");
  const text = notes({
    CLAUDE_PLUGIN_OPTION_CLOAKBROWSER: "true",
    CLAUDE_PLUGIN_OPTION_CLOAKBROWSER_HUMANIZE: "false",
    CLAUDE_PLUGIN_OPTION_CAPTCHA_OCR_DDDDOCR: "true",
  }).hookSpecificOutput.additionalContext;
  assert.match(text, /CloakBrowser/);
  assert.match(text, /--no-humanize/);
  assert.match(text, /recognize-captcha/);
});

test("hooks.json points only at scripts that exist", () => {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"),
  );
  for (const handler of Object.values(cfg.hooks)
    .flat()
    .flatMap((m) => m.hooks)) {
    assert.equal(handler.command, "bun");
    // The placeholder is literal text that Claude Code substitutes at run time.
    const prefix = /^\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\//;
    assert.match(handler.args[0], prefix);
    const script = handler.args[0].replace(prefix, "");
    assert.ok(fs.existsSync(path.join(HOOKS, script)), script);
  }
});
