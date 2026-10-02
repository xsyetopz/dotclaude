// The hooks module against the command dispatcher. Each case is an input
// from a frozen hook test. The classic path runs each action of the event
// whose matcher fits the tool through `hooks/dispatch.mjs --only`, and
// merges the outputs as the dispatcher does. The module path runs the same
// input through the `tool.call` hook over a fake `$`. Each case row gives the
// expected classic decision, and the module decision must agree with the
// classic one. The tests give each command as a string and never run it.

import { afterAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACTIONS,
  MATCH_FIELD,
  matches,
  merge,
} from "../../hooks/lib/_actions.mjs";
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

// The keys of a `tool.call` input that are not arguments of the tool.
const RESERVED = ["tool", "tool_use_id", "agentId", "consent"];

// The context that the fake `next` result carries. The module keeps it and
// adds its own context after it.
const ENGINE_CONTEXT = ["The engine context."];

/** The merged classic output of each `event` action that fits `data`. */
function classic(event, data, env) {
  const field = MATCH_FIELD[event];
  const outputs = ACTIONS[event]
    .filter(([matcher]) => matches(matcher, field ? data[field] : undefined))
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
 * The module handlers and the fake `$` of one case. A
 * `CLAUDE_PLUGIN_OPTION_*` name in `env` becomes a plugin option of
 * `register`, as Claude Code gives it. The other names, and the names that
 * `hook()` sets, go to the fake `$`. A case with `agent` runs in that
 * subagent: the agent list gives its type, and its messages give its turns.
 */
function moduleOf(c) {
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
    agents: c.agent ? [{ id: c.agent.id, type: c.agent.type }] : [],
    messages: Array.from({ length: c.agent?.turns ?? 0 }, () => ({
      role: "assistant",
    })),
  });
  return { on, $ };
}

/**
 * Run one case through the `tool.call` hook. A case with `effort` first
 * runs a main-thread step at that effort, because the module gets the
 * session effort only from a step. `next` records its input and the
 * `tool.check` verdict of the call, and its result carries `ENGINE_CONTEXT`.
 */
async function viaModule(c) {
  const { on, $ } = moduleOf(c);
  if (c.effort) await step(on, $, { effort: c.effort });
  const e = {
    tool: c.tool,
    tool_use_id: "t1",
    ...(c.agent ? { agentId: c.agent.id } : {}),
    ...c.input,
  };
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
    return {
      result: c.response ?? { stdout: "", stderr: "" },
      context: ENGINE_CONTEXT,
    };
  });
  return { e, out, calls, check, engine };
}

/** The reserved keys of a `tool.call` input. */
const reservedOf = (e) =>
  Object.fromEntries(Object.entries(e).filter(([k]) => RESERVED.includes(k)));

// The temp folders of the cases, which `afterAll` removes.
const temps = [];
afterAll(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

/**
 * The classic PreToolUse input of one case. For a case with `agent`, the
 * input has the agent fields, and the subagent transcript has its turns.
 */
function preInput(c) {
  const data = {
    session_id: session(),
    hook_event_name: "PreToolUse",
    tool_name: c.tool,
    tool_input: c.input,
    ...(c.mode ? { permission_mode: c.mode } : {}),
    ...(c.effort ? { effort: { level: c.effort } } : {}),
  };
  if (!c.agent) return data;
  const dir = tempDir("dotclaude-transcript-");
  const file = path.join(
    dir,
    data.session_id,
    "subagents",
    `agent-${c.agent.id}.jsonl`,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const turns = Array.from({ length: c.agent.turns }, (_, i) =>
    JSON.stringify({ type: "assistant", message: { id: `m${i}` } }),
  );
  fs.writeFileSync(file, `${turns.join("\n")}\n`);
  return {
    ...data,
    transcript_path: path.join(dir, `${data.session_id}.jsonl`),
    agent_id: c.agent.id,
    agent_type: c.agent.type,
  };
}

/** The decision of a merged PreToolUse output. */
function decisionOf(h) {
  const d = h?.permissionDecision;
  if (d === "deny" || d === "ask") return d;
  return h?.updatedInput ? "rewrite" : "allow";
}

/**
 * Expect the classic path to give `decision` for the case, and the module to
 * give the PreToolUse decision of the classic path. A classic `updatedInput`
 * replaces the tool arguments, and the reserved keys stay.
 */
async function samePre(c, decision) {
  const h = classic("PreToolUse", preInput(c), c.env)?.hookSpecificOutput;
  expect(decisionOf(h)).toBe(decision);
  const m = await viaModule(c);
  if (h?.permissionDecision === "deny") {
    expect(m.out).toEqual({ deny: h.permissionDecisionReason });
    expect(m.calls).toEqual([]);
    return;
  }
  expect(m.calls.length).toBe(1);
  expect(m.calls[0]).toEqual(
    h?.updatedInput ? { ...h.updatedInput, ...reservedOf(m.e) } : m.e,
  );
  expect(m.check).toEqual(
    h?.permissionDecision === "ask"
      ? { decision: "ask", reason: h.permissionDecisionReason }
      : m.engine,
  );
  expect(m.out.context).toEqual([
    ...ENGINE_CONTEXT,
    ...(h?.additionalContext ? [h.additionalContext] : []),
  ]);
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
  ["an irreversible command asks", "ask", bash("git push --force")],
  ["a destructive command is denied", "deny", bash("rm -rf ~")],
  ["a safe command passes", "allow", bash("bun test")],
  [
    "a recoverable finding asks in default mode",
    "ask",
    bash("find . -name '*.log' -delete", { mode: "default" }),
  ],
  [
    "a recoverable finding asks in auto mode with guard_ask_in_auto",
    "ask",
    bash("find . -name '*.log' -delete", {
      ...auto,
      env: { CLAUDE_PLUGIN_OPTION_GUARD_ASK_IN_AUTO: "true" },
    }),
  ],
  [
    "an irreversible command asks in auto mode",
    "ask",
    bash("git push --force", auto),
  ],
  [
    "a lockfile edit asks",
    "ask",
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
    "allow",
    bash("git push --force", {
      env: { CLAUDE_PLUGIN_OPTION_GUARD_BASH: "false" },
    }),
  ],
  [
    "the bash guard off still denies a locked model",
    "deny",
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
    "ask",
    bash(
      `bun "/p/skills/setup/scripts/${script}.mjs" --scope user --apply`,
      auto,
    ),
  ]),
  [
    "another project's migration passes",
    "allow",
    bash("bun scripts/migrate.mjs --apply", auto),
  ],
  [
    "a settings write under sudo asks",
    "ask",
    bash(
      'SUDO_ASKPASS=/p/askpass.sh sudo -A "$(command -v bun)" /p/scripts/install-managed.mjs --apply',
      auto,
    ),
  ],
  [
    "a settings rewrite with jq asks",
    "ask",
    bash(
      "jq '.permissions.deny -= [\"X\"]' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json",
      auto,
    ),
  ],
  [
    "a settings script with no apply passes",
    "allow",
    bash('bun "/p/scripts/apply-settings.mjs" --scope user', auto),
  ],
  [
    "a settings read passes",
    "allow",
    bash("jq . ~/.claude/settings.json", auto),
  ],
  [
    "a local settings edit asks",
    "ask",
    edit(path.join(repo, ".claude", "settings.local.json"), auto),
  ],
  [
    "a managed settings edit asks",
    "ask",
    edit(
      "/Library/Application Support/ClaudeCode/managed-settings.d/50-x.json",
      auto,
    ),
  ],
  [
    "another settings file passes",
    "allow",
    edit(path.join(repo, "config", "settings.json"), auto),
  ],
  ["a dev server is denied", "deny", bash("npm run dev")],
  [
    "a background dev server passes",
    "allow",
    {
      tool: "Bash",
      input: { command: "npm run dev", run_in_background: true },
    },
  ],
])("bash-guard: %s", async (_name, decision, c) => {
  await samePre(c, decision);
});

// The engine API gives no live permission mode to a module. `tool.call` and
// `tool.check` have no mode field, and `/config` has only the default mode.
// So the module judges each call as in default mode. In auto mode the classic
// path stays quiet on a recoverable finding, and the module asks. The
// `dontAsk` and `bypassPermissions` modes are unattended too
// (`UNATTENDED` in `hooks/lib/_core.mjs`), so they have the same difference.
test.todo.each(
  ["auto", "dontAsk", "bypassPermissions"].map((mode) => [
    `a recoverable finding in ${mode} mode`,
    "allow",
    bash("find . -name '*.log' -delete", { mode }),
  ]),
)("bash-guard in an unattended mode: %s", async (_name, decision, c) => {
  await samePre(c, decision);
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
// `prefer-dotclaude-agents` denies an agent with no type while forks are
// off, and rewrites a background agent. So each "passes" case names a
// foreground type that it accepts, and the model lock decides.
const typed = { subagent_type: "Explore", run_in_background: false };
test.each([
  ["sonnet passes", "allow", agent({ ...typed, model: "sonnet" })],
  [
    "fable is denied",
    "deny",
    agent({ model: "claude-fable-5-1" }, { ANTHROPIC_DEFAULT_FABLE_MODEL: "" }),
  ],
  ["an old model is denied", "deny", agent({ model: "claude-opus-4-1" })],
  ["no model passes", "allow", agent(typed)],
  [
    "a forced effort is denied",
    "deny",
    agent(
      { subagent_type: "dotclaude:mechanical-worker" },
      { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" },
    ),
  ],
  [
    "the lock off passes",
    "allow",
    agent(
      { ...typed, model: "claude-opus-4-1" },
      { CLAUDE_PLUGIN_OPTION_MODEL_LOCK: "false" },
    ),
  ],
  [
    "general-purpose is denied",
    "deny",
    agent({ subagent_type: "general-purpose" }),
  ],
  [
    "a background agent runs in the foreground",
    "rewrite",
    agent({ subagent_type: "dotclaude:implementer", run_in_background: true }),
  ],
  [
    "a session with no count allows",
    "rewrite",
    agent({ subagent_type: "dotclaude:implementer" }),
  ],
  [
    "haiku passes",
    "allow",
    agent({ ...typed, model: "haiku" }, { ANTHROPIC_DEFAULT_HAIKU_MODEL: "" }),
  ],
  [
    "opus with no prompt passes",
    "allow",
    { ...agent({}), input: { ...typed, model: "opus" } },
  ],
  [
    "no type with forks off is denied",
    "deny",
    agent({}, { CLAUDE_CODE_FORK_SUBAGENT: "false" }),
  ],
  [
    "a fork with forks on runs in the foreground",
    "rewrite",
    agent({ prompt: "fork this" }, { CLAUDE_CODE_FORK_SUBAGENT: "" }),
  ],
  [
    "Explore in the foreground passes",
    "allow",
    {
      ...agent({}),
      input: { subagent_type: "Explore", run_in_background: false },
    },
  ],
  [
    "general-purpose passes with agent_guidance off",
    "allow",
    {
      ...agent({}, { CLAUDE_PLUGIN_OPTION_AGENT_GUIDANCE: "false" }),
      input: { subagent_type: "general-purpose" },
    },
  ],
  // The session effort comes from a main-thread step.
  ...["xhigh", "max"].map((level) => [
    `sonnet at session effort ${level} is denied`,
    "deny",
    { ...agent({ model: "sonnet" }), effort: level },
  ]),
  [
    "opus at session effort max is denied",
    "deny",
    {
      ...agent({ model: "opus" }, { ANTHROPIC_DEFAULT_OPUS_MODEL: "" }),
      effort: "max",
    },
  ],
])("model-lock: %s", async (_name, decision, c) => {
  await samePre(c, decision);
});

// delete-guard.test.mjs and git-discard.test.mjs. These cases ask before git
// can tell, so the fake `$`, which has no git, gives the same input as a real
// repository. The cases that need real git status or project files are not
// here: the tracked, untracked, and gitignored paths of delete-guard, the
// paths beside the project in its temp folder, and the clean, dirty, and
// colliding repositories of git-discard.
const scratchpad = tempDir("dotclaude-cc-");
const del = (command) =>
  bash(command, {
    mode: "default",
    env: { CLAUDE_CODE_TMPDIR: scratchpad },
  });
test.each([
  [
    "a delete in the scratchpad runs",
    "allow",
    del('rm -r "$CLAUDE_CODE_TMPDIR/x"'),
  ],
  [
    "a named delete in /tmp runs",
    "allow",
    del("cd /tmp && rm -rf oc-shots/$n"),
  ],
  ["a whole temp folder asks", "ask", del("find /tmp -delete")],
  ["a run-time name in a temp folder asks", "ask", del("cd /tmp && rm -rf $n")],
  [
    "a variable outside the temp folders asks",
    "ask",
    del('S="$HOME/x"; rm -rf "$S"'),
  ],
  ["a parent segment asks", "ask", del('S="$TMPDIR/../x"; rm -rf "$S"')],
  ["a glob after a temp variable asks", "ask", del('find "$TMPDIR/"* -delete')],
  [
    "a reassigned temp variable asks",
    "ask",
    del('CLAUDE_CODE_TMPDIR=/; rm -rf "$CLAUDE_CODE_TMPDIR/etc"'),
  ],
  ["a run-time path asks", "ask", del("git checkout -- $F")],
  ["a run-time folder asks", "ask", del("cd $W && git reset --hard")],
  ["a folder under home asks", "ask", del("git -C ~/w reset --hard")],
])("delete-guard and git-discard: %s", async (_name, decision, c) => {
  await samePre(c, decision);
});

// agent-budget.test.mjs. A call from a subagent with 76 turns. The classic
// path gets the agent type in `agent_type`, and the module gets it from the
// agent list. The type gives the turn limit: `dotclaude:implementer` has 80
// turns, and `Explore` has no limit.
const inAgent = (type) => bash("ls", { agent: { id: "a1", type, turns: 76 } });
test.each([
  [
    "an agent near its turn limit is denied",
    "deny",
    inAgent("dotclaude:implementer"),
  ],
  ["an agent with no turn limit passes", "allow", inAgent("Explore")],
])("agent-budget: %s", async (_name, decision, c) => {
  await samePre(c, decision);
});

/**
 * Expect the classic path to give `decision` for a subagent start: "context"
 * when its actions give context, else "allow". Then expect the module to put
 * the same context before the prompt in `agent.spawn`.
 */
async function sameStart(c, decision) {
  const data = {
    session_id: session(),
    hook_event_name: "SubagentStart",
    agent_id: "a1",
    agent_type: c.type,
  };
  const h = classic("SubagentStart", data, c.env)?.hookSpecificOutput;
  expect(h?.additionalContext ? "context" : "allow").toBe(decision);
  const { on, $ } = moduleOf(c);
  const e = {
    tool_use_id: "t1",
    prompt: "Fix the bug.",
    description: "fix",
    subagentType: c.type,
    background: false,
    fork: false,
  };
  const calls = [];
  const result = { model: "m", agentId: "a1" };
  const out = await on["agent.spawn"]($, e, async (input) => {
    calls.push(input);
    return result;
  });
  expect(out).toBe(result);
  expect(calls).toEqual([
    {
      ...e,
      prompt: h?.additionalContext
        ? `${h.additionalContext}\n\n${e.prompt}`
        : e.prompt,
    },
  ]);
}

// subagent-start.test.mjs. The second start of the same agent (a
// `SendMessage` resume) is not here: the classic path needs the marker of the
// first start on disk, and `agent.spawn` has no agent id before `next`. The
// running markers of `count-running-agents` give no context, and
// register-agents.test.mjs checks them.
test.each([
  [
    "general-purpose gets the conventions",
    "context",
    { type: "general-purpose" },
  ],
  [
    "an implementer gets its turn limit",
    "context",
    { type: "dotclaude:implementer" },
  ],
  [
    "the reviewer gets only its limits",
    "context",
    { type: "dotclaude:reviewer" },
  ],
  [
    "an investigator gets the conventions",
    "context",
    { type: "dotclaude:investigator" },
  ],
  ["Explore gets the conventions", "context", { type: "Explore" }],
  [
    "usage_agent_bounds off leaves out the context bound",
    "context",
    {
      type: "dotclaude:implementer",
      env: { CLAUDE_PLUGIN_OPTION_USAGE_AGENT_BOUNDS: "false" },
    },
  ],
  [
    "agent_guidance off gives nothing",
    "allow",
    {
      type: "Explore",
      env: { CLAUDE_PLUGIN_OPTION_AGENT_GUIDANCE: "false" },
    },
  ],
])("subagent-start: %s", async (_name, decision, c) => {
  await sameStart(c, decision);
});

/**
 * Expect the classic path to give `decision` for the case: "rewrite" when it
 * redacts the output, else "allow". Then expect the module to give the
 * PostToolUse output of the classic path. The module result is the classic
 * `updatedToolOutput`, or the response unchanged when the classic path
 * redacts nothing.
 */
async function samePost(c, decision) {
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
  expect(h?.updatedToolOutput ? "rewrite" : "allow").toBe(decision);
  const m = await viaModule(c);
  expect(m.out.result).toEqual(h?.updatedToolOutput ?? c.response);
  expect(m.out.context).toEqual([
    ...ENGINE_CONTEXT,
    ...(h?.additionalContext ? [h.additionalContext] : []),
  ]);
}

// redact-secrets.test.mjs. The token is fixed, so Betterleaks always reports
// it: a random draw can have low entropy, and Betterleaks skips such a token.
// The parts are joined at run time, so this file holds no whole token. The
// fake `$` reports the token as Betterleaks does.
const token = ["ghp", "qmLATDSAphR0Rhi70esgZR9lIdaKaz7ZMNeN"].join("_");
const output = (stdout, extra = {}) => ({
  tool: "Bash",
  input: {},
  response: { stdout, stderr: "", interrupted: false },
  ...extra,
});
test.skipIf(!hasScanner).each([
  [
    "a GitHub token is redacted",
    "rewrite",
    output(`line one\ntoken=${token}\nend\n`, {
      secrets: [{ secret: token, rule: "github-pat" }],
    }),
  ],
  ["clean output passes", "allow", output("hello world\n")],
])("redact-secrets: %s", async (_name, decision, c) => {
  await samePost(c, decision);
});
test.each([
  [
    "the guard_secrets option turns redaction off",
    "allow",
    output(token, {
      secrets: [{ secret: token, rule: "github-pat" }],
      env: { CLAUDE_PLUGIN_OPTION_GUARD_SECRETS: "false" },
    }),
  ],
])("redact-secrets: %s", async (_name, decision, c) => {
  await samePost(c, decision);
});
