// The hooks module against the command dispatcher. Each case is an input
// from a frozen hook test. The classic path runs each action of the event
// whose matcher fits the tool through `hooks/dispatch.mjs --only`, and
// merges the outputs as the dispatcher does. The module path runs the same
// input through the `tool.call` hook over a fake `$`. The two decisions must
// agree. The tests give each command as a string and never run it.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ACTIONS, matches, merge } from "../../hooks/lib/_actions.mjs";
import { HOOKS, hook, noAccount, repo, session } from "../support/hooks.mjs";
import { fake, registered } from "./fake-engine.mjs";

const hasScanner = Bun.which("betterleaks") !== null;

// The fake `$` has the agent definitions at the fake plugin root.
const AGENTS = path.join(HOOKS, "..", "agents");
const agentFiles = Object.fromEntries(
  fs
    .readdirSync(AGENTS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [
      `/plugins/dotclaude/agents/${f}`,
      fs.readFileSync(path.join(AGENTS, f), "utf8"),
    ]),
);

/** The merged classic output of each `event` action that fits `data`. */
function classic(event, data, env) {
  const outputs = ACTIONS[event]
    .filter(([matcher]) => matches(matcher, data.tool_name))
    .map(([, action]) => hook(action, data, env))
    .filter(Boolean);
  return merge(outputs) ?? null;
}

/** Run a `turn.step` hook to its end. Its `next` yields no chunk. */
async function step(on, $, e) {
  const stream = on["turn.step"]($, e, async function* () {
    yield* [];
    return {};
  });
  while (!(await stream.next()).done);
}

/**
 * Run one case through the `tool.call` hook. A `CLAUDE_PLUGIN_OPTION_*` name
 * in `env` becomes a plugin option of `register`, as Claude Code gives it.
 * The other names, and the names that `hook()` sets, go to the fake `$`.
 * A case with `effort` first runs a main-thread step at that effort, because
 * the module gets the session effort only from a step. `next` records its
 * input and the `tool.check` verdict of the call.
 */
async function viaModule(c) {
  const options = {};
  const env = {
    ...process.env,
    CLAUDE_CODE_DISABLE_FAST_MODE: "1",
    CLAUDE_CONFIG_DIR: noAccount,
    ANTHROPIC_API_KEY: "",
  };
  for (const [name, value] of Object.entries(c.env ?? {})) {
    const key = /^CLAUDE_PLUGIN_OPTION_(.+)$/.exec(name)?.[1];
    if (key) options[key.toLowerCase()] = value;
    else env[name] = value;
  }
  const on = registered(options);
  const $ = fake({
    env,
    cwd: repo,
    files: agentFiles,
    secrets: c.secrets,
  });
  if (c.effort) await step(on, $, { effort: c.effort });
  const e = { tool: c.tool, tool_use_id: "t1", ...c.input };
  const engine = { decision: "allow" };
  const calls = [];
  let check;
  const out = await on["tool.call"]($, e, async (input) => {
    calls.push(input);
    check = await on["tool.check"](
      $,
      { tool: c.tool, input: {}, tool_use_id: "t1" },
      async () => engine,
    );
    return { result: c.response ?? { stdout: "", stderr: "" } };
  });
  return { e, out, calls, check, engine };
}

/** The classic PreToolUse input of one case. */
const preInput = (c) => ({
  session_id: session(),
  hook_event_name: "PreToolUse",
  tool_name: c.tool,
  tool_input: c.input,
  ...(c.mode ? { permission_mode: c.mode } : {}),
  ...(c.effort ? { effort: { level: c.effort } } : {}),
});

/** Expect the module to give the PreToolUse decision of the classic path. */
async function samePre(c) {
  const h = classic("PreToolUse", preInput(c), c.env)?.hookSpecificOutput;
  const m = await viaModule(c);
  if (h?.permissionDecision === "deny") {
    expect(m.out).toEqual({ deny: h.permissionDecisionReason });
    expect(m.calls).toEqual([]);
    return;
  }
  expect(m.calls.length).toBe(1);
  expect(m.calls[0]).toEqual(
    h?.updatedInput ? { ...m.e, ...h.updatedInput } : m.e,
  );
  expect(m.check).toEqual(
    h?.permissionDecision === "ask"
      ? { decision: "ask", reason: h.permissionDecisionReason }
      : m.engine,
  );
  if (h?.additionalContext)
    expect(m.out.context).toContain(h.additionalContext);
}

const bash = (command, extra = {}) => ({
  tool: "Bash",
  input: { command },
  ...extra,
});
const edit = (file_path, extra = {}) => ({
  tool: "Edit",
  input: { file_path, old_string: '"a": 1', new_string: '"a": 2' },
  ...extra,
});
const auto = { mode: "auto" };

// bash-guard.test.mjs. The cases with a transcript, a verdict log, or an
// approved ask need disk state, so they are not here.
test.each([
  ["an irreversible command asks", bash("git push --force")],
  ["a destructive command is denied", bash("rm -rf ~")],
  ["a safe command passes", bash("bun test")],
  [
    "a recoverable finding asks in default mode",
    bash("find . -name '*.log' -delete", { mode: "default" }),
  ],
  [
    "a recoverable finding asks in auto mode with guard_ask_in_auto",
    bash("find . -name '*.log' -delete", {
      ...auto,
      env: { CLAUDE_PLUGIN_OPTION_GUARD_ASK_IN_AUTO: "true" },
    }),
  ],
  ["an irreversible command asks in auto mode", bash("git push --force", auto)],
  [
    "a lockfile edit asks",
    {
      tool: "Edit",
      input: {
        file_path: path.join(repo, "package-lock.json"),
        old_string: "a",
        new_string: "b",
      },
    },
  ],
  [
    "the bash guard off passes a push",
    bash("git push --force", {
      env: { CLAUDE_PLUGIN_OPTION_GUARD_BASH: "false" },
    }),
  ],
  [
    "the bash guard off still denies a locked model",
    bash("claude --model claude-opus-4-1 -p hi", {
      env: { CLAUDE_PLUGIN_OPTION_GUARD_BASH: "false" },
    }),
  ],
  ...[
    "apply-settings",
    "apply-claude-md",
    "apply-statusline",
    "install-managed",
    "migrate",
  ].map((script) => [
    `a settings write asks in auto mode: ${script}`,
    bash(
      `bun "/p/skills/setup/scripts/${script}.mjs" --scope user --apply`,
      auto,
    ),
  ]),
  [
    "another project's migration passes",
    bash("bun scripts/migrate.mjs --apply", auto),
  ],
  [
    "a settings write under sudo asks",
    bash(
      'SUDO_ASKPASS=/p/askpass.sh sudo -A "$(command -v bun)" /p/scripts/install-managed.mjs --apply',
      auto,
    ),
  ],
  [
    "a settings rewrite with jq asks",
    bash(
      "jq '.permissions.deny -= [\"X\"]' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json",
      auto,
    ),
  ],
  [
    "a settings script with no apply passes",
    bash('bun "/p/scripts/apply-settings.mjs" --scope user', auto),
  ],
  ["a settings read passes", bash("jq . ~/.claude/settings.json", auto)],
  [
    "a local settings edit asks",
    edit(path.join(repo, ".claude", "settings.local.json"), auto),
  ],
  [
    "a managed settings edit asks",
    edit(
      "/Library/Application Support/ClaudeCode/managed-settings.d/50-x.json",
      auto,
    ),
  ],
  [
    "another settings file passes",
    edit(path.join(repo, "config", "settings.json"), auto),
  ],
  ["a dev server is denied", bash("npm run dev")],
  [
    "a background dev server passes",
    {
      tool: "Bash",
      input: { command: "npm run dev", run_in_background: true },
    },
  ],
])("bash-guard: %s", async (_name, c) => {
  await samePre(c);
});

// The engine API gives no live permission mode to a module. `tool.call` and
// `tool.check` have no mode field, and `/config` has only the default mode.
// So the module judges each call as in default mode. In auto mode the classic
// path stays quiet on a recoverable finding, and the module asks.
test.todo.each([
  ["a recoverable finding", bash("find . -name '*.log' -delete", auto)],
])("bash-guard in auto mode: %s", async (_name, c) => {
  await samePre(c);
});

// model-lock.test.mjs and the stateless case of agent-concurrency.test.mjs.
const agent = (input, env = {}) => ({
  tool: "Agent",
  input: { prompt: "x", ...input },
  env: {
    ANTHROPIC_DEFAULT_SONNET_MODEL: "",
    CLAUDE_CODE_EFFORT_LEVEL: "",
    ...env,
  },
});
test.each([
  ["sonnet passes", agent({ model: "sonnet" })],
  [
    "fable is denied",
    agent({ model: "claude-fable-5-1" }, { ANTHROPIC_DEFAULT_FABLE_MODEL: "" }),
  ],
  ["an old model is denied", agent({ model: "claude-opus-4-1" })],
  ["no model passes", agent({})],
  [
    "a forced effort is denied",
    agent(
      { subagent_type: "dotclaude:mechanical-worker" },
      { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" },
    ),
  ],
  [
    "the lock off passes",
    agent(
      { model: "claude-opus-4-1" },
      { CLAUDE_PLUGIN_OPTION_MODEL_LOCK: "false" },
    ),
  ],
  ["general-purpose is denied", agent({ subagent_type: "general-purpose" })],
  [
    "a background agent runs in the foreground",
    agent({ subagent_type: "dotclaude:implementer", run_in_background: true }),
  ],
  [
    "a session with no count allows",
    agent({ subagent_type: "dotclaude:implementer" }),
  ],
  [
    "haiku passes",
    agent({ model: "haiku" }, { ANTHROPIC_DEFAULT_HAIKU_MODEL: "" }),
  ],
  ["opus with no prompt passes", { ...agent({}), input: { model: "opus" } }],
  [
    "no type with forks off is denied",
    agent({}, { CLAUDE_CODE_FORK_SUBAGENT: "false" }),
  ],
  [
    "a fork with forks on runs in the foreground",
    agent({ prompt: "fork this" }, { CLAUDE_CODE_FORK_SUBAGENT: "" }),
  ],
  [
    "Explore in the foreground passes",
    {
      ...agent({}),
      input: { subagent_type: "Explore", run_in_background: false },
    },
  ],
  [
    "general-purpose passes with agent_guidance off",
    {
      ...agent({}, { CLAUDE_PLUGIN_OPTION_AGENT_GUIDANCE: "false" }),
      input: { subagent_type: "general-purpose" },
    },
  ],
  // The session effort comes from a main-thread step.
  ...["xhigh", "max"].map((level) => [
    `sonnet at session effort ${level} is denied`,
    { ...agent({ model: "sonnet" }), effort: level },
  ]),
  [
    "opus at session effort max is denied",
    {
      ...agent({ model: "opus" }, { ANTHROPIC_DEFAULT_OPUS_MODEL: "" }),
      effort: "max",
    },
  ],
])("model-lock: %s", async (_name, c) => {
  await samePre(c);
});

// delete-guard.test.mjs and git-discard.test.mjs. These cases ask before git
// can tell, so the fake `$`, which has no git, gives the same input as a real
// repository. The cases that need real git status or project files are not
// here: the tracked, untracked, and gitignored paths of delete-guard, the
// paths beside the project in its temp folder, and the clean, dirty, and
// colliding repositories of git-discard.
const scratchpad = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-cc-"));
const del = (command) =>
  bash(command, {
    mode: "default",
    env: { CLAUDE_CODE_TMPDIR: scratchpad },
  });
test.each([
  ["a delete in the scratchpad runs", del('rm -r "$CLAUDE_CODE_TMPDIR/x"')],
  ["a named delete in /tmp runs", del("cd /tmp && rm -rf oc-shots/$n")],
  ["a whole temp folder asks", del("find /tmp -delete")],
  ["a run-time name in a temp folder asks", del("cd /tmp && rm -rf $n")],
  ["a variable outside the temp folders asks", del('S="$HOME/x"; rm -rf "$S"')],
  ["a parent segment asks", del('S="$TMPDIR/../x"; rm -rf "$S"')],
  ["a glob after a temp variable asks", del('find "$TMPDIR/"* -delete')],
  [
    "a reassigned temp variable asks",
    del('CLAUDE_CODE_TMPDIR=/; rm -rf "$CLAUDE_CODE_TMPDIR/etc"'),
  ],
  ["a run-time path asks", del("git checkout -- $F")],
  ["a run-time folder asks", del("cd $W && git reset --hard")],
  ["a folder under home asks", del("git -C ~/w reset --hard")],
])("delete-guard and git-discard: %s", async (_name, c) => {
  await samePre(c);
});

/**
 * Expect the module to give the PostToolUse output of the classic path. The
 * module result is the classic `updatedToolOutput`, or the response
 * unchanged when the classic path redacts nothing.
 */
async function samePost(c) {
  const h = classic(
    "PostToolUse",
    {
      session_id: session(),
      hook_event_name: "PostToolUse",
      tool_name: c.tool,
      tool_input: c.input,
      tool_response: c.response,
    },
    c.env,
  )?.hookSpecificOutput;
  const m = await viaModule(c);
  expect(m.out.result).toEqual(h?.updatedToolOutput ?? c.response);
  if (h?.additionalContext)
    expect(m.out.context).toContain(h.additionalContext);
}

// redact-secrets.test.mjs. The token is made at run time, so this file
// holds no secret. It is random, because Betterleaks skips a token with low
// entropy. The fake `$` reports the token as Betterleaks does.
const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const token = `ghp_${Array.from(
  { length: 36 },
  () => chars[Math.floor(Math.random() * chars.length)],
).join("")}`;
const output = (stdout, extra = {}) => ({
  tool: "Bash",
  input: {},
  response: { stdout, stderr: "", interrupted: false },
  ...extra,
});
test.skipIf(!hasScanner)(
  "redact-secrets: a GitHub token is redacted",
  async () => {
    await samePost(
      output(`line one\ntoken=${token}\nend\n`, {
        secrets: [{ secret: token, rule: "github-pat" }],
      }),
    );
  },
);
test.skipIf(!hasScanner)("redact-secrets: clean output passes", async () => {
  await samePost(output("hello world\n"));
});
test("redact-secrets: the guard_secrets option turns redaction off", async () => {
  await samePost(
    output(token, {
      secrets: [{ secret: token, rule: "github-pat" }],
      env: { CLAUDE_PLUGIN_OPTION_GUARD_SECRETS: "false" },
    }),
  );
});
