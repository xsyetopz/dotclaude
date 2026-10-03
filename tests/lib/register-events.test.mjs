// The PostToolUseFailure, UserPromptSubmit, and PreCompact actions in the
// hooks module, over a fake `on` and a small fake of the engine's `$`. The
// tests give each command as a string. They never run a guarded command.

import { expect, test } from "bun:test";
import { CONTEXT_NOTE_TOKENS } from "../../hooks/lib/_budget.mjs";
import { compactionsFile } from "../../hooks/lib/_io-mod.mjs";
import { noticeFile } from "../../hooks/lib/_reminder.mjs";
import {
  COMPACT_HANDOFF_TEXT,
  COMPACT_TEXT,
  modIo,
  register,
  SILENT_TURN_TEXT,
} from "../../hooks/register.mjs";
import { fake, registered } from "./fake-engine.mjs";

/** The ledger state of the main session `s1`, or null. */
function ledger($) {
  for (const [file, text] of $.files)
    if (file.endsWith("/sessions/s1.json")) return JSON.parse(text);
  return null;
}

test("a failed Edit gets the closest lines of the file as context", async () => {
  const on = registered();
  const $ = fake({
    files: { "/work/a.js": "const one = 1;\nconst two = 2;\nconst three = 3;" },
  });
  const failed = {
    isError: true,
    result: "String to replace not found in file.",
    text: "<tool_use_error>String to replace not found in file.\nString: const twoo = 2;</tool_use_error>",
  };
  const out = await on["tool.call"](
    $,
    {
      tool: "Edit",
      tool_use_id: "t1",
      file_path: "/work/a.js",
      old_string: "const twoo = 2;",
      new_string: "const two = 22;",
    },
    async () => failed,
  );
  expect(out.isError).toBe(true);
  expect(out.text).toBe(failed.text);
  expect(out.context).toHaveLength(1);
  expect(out.context[0]).toContain("matches no text in `a.js`");
  expect(out.context[0]).toContain("2\tconst two = 2;");
});

test("a failed Bash check is recorded with its exit code", async () => {
  const on = registered();
  const $ = fake();
  await on["tool.call"](
    $,
    { tool: "Bash", tool_use_id: "t1", command: "bun test" },
    async () => ({ isError: true, result: "x", text: "Exit code 3\nFAIL" }),
  );
  expect(ledger($)?.lastCheck).toMatchObject({
    command: "bun test",
    ok: false,
    code: 3,
  });
});

test("prompt.submit attaches the context note on the way down", async () => {
  const on = registered({ context_auto_clear: false });
  const $ = fake();
  $.session.usage = async () => ({ context: { tokens: 150_000 } });
  $.files.set(compactionsFile(await modIo($), "s1"), "4");
  const calls = [];
  const next = async (e) => {
    calls.push(e);
    return { text: e.text, context: e.context };
  };
  const e = { text: "go on", context: ["mine"], wait: false, origin: {} };
  await on["prompt.submit"]($, e, next);
  expect(calls).toHaveLength(1);
  expect(calls[0].text).toBe("go on");
  expect(calls[0].context[0]).toBe("mine");
  expect(calls[0].context[1]).toContain("<context_use");
});

test("prompt.submit passes the input unchanged when no note applies", async () => {
  const on = registered();
  const e = { text: "hi", wait: false, origin: {} };
  const seen = [];
  await on["prompt.submit"](fake(), e, async (x) => {
    seen.push(x);
    return { text: x.text };
  });
  expect(seen).toEqual([e]);
});

const typed = (text) => ({ role: "user", text });

test("session.compact saves the recent prompts and continues", async () => {
  const on = registered();
  const $ = fake({
    messages: [typed("first ask"), { role: "assistant", text: "ok" }],
  });
  const done = { messages: [] };
  const e = { trigger: "auto", messages: [] };
  const seen = [];
  const out = await on["session.compact"]($, e, async (x) => {
    seen.push(x);
    return done;
  });
  expect(out).toBe(done);
  expect(seen).toEqual([{ ...e, instructions: COMPACT_TEXT }]);
  expect(ledger($)?.prompts).toEqual(["first ask"]);
});

/** The instructions that `session.compact` gives to `next`. */
async function compactText(on, $, e) {
  let given;
  await on["session.compact"]($, e, async (x) => {
    given = x.instructions;
    return { messages: [] };
  });
  return given;
}

test("session.compact adds the handoff text after 4 compactions", async () => {
  const on = registered();
  const $ = fake();
  const e = { trigger: "auto", messages: [], instructions: "mine" };
  expect(await compactText(on, $, e)).toBe(`mine\n\n${COMPACT_TEXT}`);
  $.files.set(compactionsFile(await modIo($), "s1"), "4");
  expect(await compactText(on, $, e)).toBe(
    `mine\n\n${COMPACT_TEXT}\n\n${COMPACT_HANDOFF_TEXT}`,
  );
  expect(await compactText(on, $, { ...e, agentId: "a1" })).toBe(
    `mine\n\n${COMPACT_TEXT}`,
  );
  const off = registered({ context_compact_carryover: false });
  expect(await compactText(off, $, e)).toBe("mine");
});

test("a precompute saves nothing and continues", async () => {
  const on = registered();
  const $ = fake({ messages: [typed("first ask")] });
  const e = { trigger: "precompute", messages: [] };
  const out = await on["session.compact"]($, e, async () => ({ skip: "x" }));
  expect(out).toEqual({ skip: "x" });
  expect(ledger($)).toBeNull();
});

const offer = (agent, source = "built-in") => ({
  agent,
  description: "x",
  source,
  provider: { plugin: source === "built-in" ? "engine" : "p", tier: "core" },
});
const offered = { isOffered: true };

test("agent.offer hides the built-in agents that dotclaude replaces", async () => {
  const on = registered();
  for (const agent of [
    "general-purpose",
    "claude",
    "Explore",
    "Plan",
    "statusline-setup",
  ])
    expect(
      await on["agent.offer"](fake(), offer(agent), async () => offered),
    ).toEqual({
      isOffered: false,
    });
  for (const agent of ["claude-code-guide", "dotclaude:reviewer"])
    expect(
      await on["agent.offer"](fake(), offer(agent), async () => offered),
    ).toBe(offered);
});

test("agent.offer keeps a plugin agent with a built-in name, and all with the option off", async () => {
  const next = async () => offered;
  expect(
    await registered()["agent.offer"](fake(), offer("Plan", "plugin"), next),
  ).toBe(offered);
  const off = registered({ agent_guidance: false });
  expect(await off["agent.offer"](fake(), offer("claude"), next)).toBe(offered);
});

const attachment = (type, kind = "engine") => ({
  type,
  text: "Use the task tools.",
  origin: { kind },
});
const kept = { text: "kept" };

test("prompt.attachment replaces the text of the silent-turn reminder", async () => {
  const on = registered();
  const seen = [];
  const next = async (x) => {
    seen.push(x);
    return kept;
  };
  const e = attachment("silent_turn_reminder");
  expect(await on["prompt.attachment"](fake(), e, next)).toBe(kept);
  expect(seen).toEqual([{ ...e, text: SILENT_TURN_TEXT }]);
  const other = attachment("date");
  await on["prompt.attachment"](fake(), other, next);
  expect(seen[1]).toBe(other);
  const plugin = attachment("silent_turn_reminder", "plugin");
  await on["prompt.attachment"](fake(), plugin, next);
  expect(seen[2]).toBe(plugin);
});

test("prompt.attachment leaves out the engine task reminders", async () => {
  const on = registered();
  for (const type of ["task_reminder", "todo_reminder"])
    expect(
      await on["prompt.attachment"](fake(), attachment(type), async () => kept),
    ).toEqual({
      text: null,
    });
  expect(
    await on["prompt.attachment"](fake(), attachment("date"), async () => kept),
  ).toBe(kept);
  expect(
    await on["prompt.attachment"](
      fake(),
      attachment("task_reminder", "plugin"),
      async () => kept,
    ),
  ).toBe(kept);
  const off = registered({ gate_tasks: false });
  expect(
    await off["prompt.attachment"](
      fake(),
      attachment("task_reminder"),
      async () => kept,
    ),
  ).toBe(kept);
});

/** A fake `$` with a model fork and a log of the commands that ran. */
function withFork(fork, init = {}) {
  const $ = fake(init);
  const ran = [];
  const run = $.process.run;
  $.process.run = async (argv, opts) => {
    ran.push(argv);
    if (argv[0] === "git") return { exitCode: 0, stdout: "main\n", stderr: "" };
    if (argv[0] === "terminal-notifier" && init.noNotifier)
      throw new Error("not found");
    if (argv[0] === "terminal-notifier" || argv[0] === "osascript")
      return { exitCode: 0, stdout: "", stderr: "" };
    return run(argv, opts);
  };
  $.model = { fork: async (x) => fork(x) };
  $.ran = ran;
  return $;
}

const handoffFiles = ($) =>
  [...$.files].filter(([file]) => file.includes("/.claude/handoffs/"));

/** A typed prompt, and a fake whose main context is `tokens`. */
const prompted = (text = "next step", extra = {}) => ({
  text,
  wait: false,
  origin: { kind: "composer" },
  ...extra,
});
function bigContext(fork, tokens = CONTEXT_NOTE_TOKENS, init = {}) {
  const $ = withFork(fork, init);
  $.session.usage = async () => ({ context: { tokens } });
  return $;
}
const settle = () => new Promise((done) => setTimeout(done, 5));
const answer = async () => ({ isAnswered: true, text: "## Goal\nship it" });

test("a typed prompt at the context bound saves a note, clears, and sends the prompt again", async () => {
  const on = registered();
  const $ = bigContext(answer);
  let passed = false;
  const out = await on["prompt.submit"]($, prompted(), async (e) => {
    passed = true;
    return e;
  });
  expect(passed).toBe(false);
  const [[path, note]] = handoffFiles($);
  expect(path).toEndWith("-clear.md");
  expect(note).toContain("status: in-progress");
  expect(note).toContain("ship it");
  expect(out.drop).toContain(path);
  // The clear runs after the hook returns, not inside it.
  expect($.commands).toEqual([]);
  await settle();
  expect($.commands).toEqual([{ command: "clear" }]);
  expect($.prompts).toEqual([{ text: "next step", asUser: true }]);
});

test("a failed clear still sends the prompt again", async () => {
  const on = registered();
  const $ = bigContext(answer, CONTEXT_NOTE_TOKENS, { commandFails: true });
  await on["prompt.submit"]($, prompted(), async (e) => e);
  await settle();
  expect($.prompts).toEqual([{ text: "next step", asUser: true }]);
});

test("the prompt passes with no clear when the auto clear does not apply", async () => {
  const cases = [
    [
      "off",
      { context_auto_clear: false },
      answer,
      CONTEXT_NOTE_TOKENS,
      prompted(),
    ],
    ["under the bound", {}, answer, CONTEXT_NOTE_TOKENS - 1, prompted()],
    [
      "attachments",
      {},
      answer,
      CONTEXT_NOTE_TOKENS,
      prompted("look", { attachments: [{ kind: "image" }] }),
    ],
    [
      "a prompt into a running turn",
      {},
      answer,
      CONTEXT_NOTE_TOKENS,
      prompted("also", { turnId: "t1" }),
    ],
    [
      "a plugin's prompt",
      {},
      answer,
      CONTEXT_NOTE_TOKENS,
      prompted("again", { origin: { kind: "plugin", name: "dotclaude" } }),
    ],
    [
      "a failed fork",
      {},
      async () => ({ isAnswered: false, reason: "nothing-to-fork" }),
      CONTEXT_NOTE_TOKENS,
      prompted(),
    ],
  ];
  for (const [name, options, fork, tokens, e] of cases) {
    const on = registered(options);
    const $ = bigContext(fork, tokens);
    const seen = [];
    const out = await on["prompt.submit"]($, e, async (x) => {
      seen.push(x);
      return { text: x.text };
    });
    await settle();
    expect(out.drop, name).toBeUndefined();
    expect(seen, name).toHaveLength(1);
    expect(seen[0].text, name).toBe(e.text);
    expect($.commands, name).toEqual([]);
    expect($.prompts, name).toEqual([]);
    expect(
      handoffFiles($).filter(([f]) => f.endsWith("-clear.md")),
      name,
    ).toHaveLength(0);
  }
});

test("the compaction handoff is on by default and off when the option is false", async () => {
  let forks = 0;
  const $ = withFork(async () => {
    forks++;
    return { isAnswered: true, text: "x" };
  });
  const compact = (options) =>
    registered(options)["session.compact"](
      $,
      { trigger: "auto" },
      async () => ({
        messages: [],
      }),
    );
  await compact();
  expect(forks).toBe(1);
  await compact({ context_compaction_handoff: false });
  expect(forks).toBe(1);
});

test("the compaction handoff forks first, saves the note, and appends a row", async () => {
  const order = [];
  const $ = withFork(async () => {
    order.push("fork");
    return { isAnswered: true, text: "## Goal\nship it" };
  });
  const on = registered({ context_compaction_handoff: true });
  const out = await on["session.compact"]($, { trigger: "auto" }, async () => {
    order.push("next");
    return { messages: [{ role: "assistant", text: "sum" }] };
  });
  expect(order).toEqual(["fork", "next"]);
  const [[file, text]] = handoffFiles($);
  expect(file).toMatch(
    /\/\.claude\/handoffs\/\d{4}-\d\d-\d\d-\d{4}-compaction\.md$/,
  );
  expect(text).toStartWith("---\nstatus: in-progress\nbranch: main\n");
  expect(text).toContain("## Goal\nship it");
  expect(out.messages).toHaveLength(2);
  expect(out.messages[1].role).toBe("user");
  expect(out.messages[1].text).toContain("ship it");
});

test("a failed or unanswered fork leaves the compaction as it was", async () => {
  const on = registered({ context_compaction_handoff: true });
  for (const fork of [
    async () => {
      throw new Error("prompt too long");
    },
    async () => ({ isAnswered: false, reason: "nothing-to-fork" }),
  ]) {
    const $ = withFork(fork, { env: { DOTCLAUDE_DEBUG: "1" } });
    const done = { messages: [] };
    const out = await on["session.compact"](
      $,
      { trigger: "auto" },
      async () => done,
    );
    expect(out).toBe(done);
    expect(handoffFiles($)).toHaveLength(0);
    const log = [...$.files].find(([f]) => f.endsWith("handoff.log"));
    expect(log[1]).toContain("compaction without a handoff note");
  }
});

test("a subagent compaction makes no handoff", async () => {
  let forked = false;
  const $ = withFork(async () => {
    forked = true;
    return { isAnswered: true, text: "x" };
  });
  const on = registered({ context_compaction_handoff: true });
  await on["session.compact"](
    $,
    { trigger: "auto", agentId: "a1" },
    async () => ({
      messages: [],
    }),
  );
  expect(forked).toBe(false);
});

const asked = [
  typed("fix the build\nplease"),
  { role: "assistant", text: "ok" },
];
const notices = ($) =>
  $.ran.filter((a) => a[0] === "terminal-notifier" || a[0] === "osascript");

test("a main turn end and a question notify by default", async () => {
  const on = registered();
  const $ = withFork(null, { messages: asked, cwd: "/home/u/proj" });
  const r = { ok: 1 };
  expect(await on["turn.complete"]($, { answer: "a" }, async () => r)).toBe(r);
  await on["tool.call"](
    $,
    { tool: "AskUserQuestion", input: {} },
    async () => ({
      result: "x",
    }),
  );
  const [first, second] = notices($);
  expect(first[0]).toBe("terminal-notifier");
  expect(first.at(-1)).toBe("fix the build | s1 | proj");
  expect(second.at(-1)).toBe("fix the build | s1 | proj");
});

test("a subagent turn end, an interrupted turn, and the option off give no notification", async () => {
  const $ = withFork(null, { messages: asked });
  await registered()["turn.complete"]($, { agentId: "a1" }, async () => ({}));
  await registered()["turn.complete"](
    $,
    { reason: "aborted" },
    async () => ({}),
  );
  await registered({ notify_desktop: false })["turn.complete"](
    $,
    {},
    async () => ({}),
  );
  expect(notices($)).toHaveLength(0);
  await registered()["turn.complete"]($, {}, async () => ({}));
  expect(notices($)).toHaveLength(1);
});

test("with no sender, a notification fails silently and sets no reminder", async () => {
  const $ = withFork(null, { messages: asked });
  const run = $.process.run;
  $.process.run = async (argv, opts) => {
    if (argv[0] === "terminal-notifier" || argv[0] === "osascript") {
      $.ran.push(argv);
      throw new Error("not found");
    }
    return run(argv, opts);
  };
  const on = withReminder(5);
  await on["turn.complete"]($, {}, async () => ({ ok: 1 }));
  await wait(30);
  expect(notices($)).toHaveLength(2);
});

/** The handlers of a module whose reminder comes after `ms`. */
function withReminder(ms) {
  const on = {};
  register(
    (name, hook) => {
      on[name] = hook;
    },
    {},
    undefined,
    ms,
  );
  return on;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("an unanswered notice gets exactly one reminder", async () => {
  const $ = withFork(null, { messages: asked });
  const on = withReminder(10);
  await on["turn.complete"]($, {}, async () => ({}));
  expect(notices($)).toHaveLength(1);
  await wait(60);
  const [first, reminder] = notices($);
  expect(notices($)).toHaveLength(2);
  expect(first[2]).toBe("Claude Code finished a turn");
  expect(reminder[2]).toBe("Reminder: Claude Code finished a turn");
  expect(reminder.at(-1)).toBe(first.at(-1));
});

test("a prompt cancels the reminder of a turn end", async () => {
  const $ = withFork(null, { messages: asked });
  const on = withReminder(20);
  await on["turn.complete"]($, {}, async () => ({}));
  await on["prompt.submit"]($, { text: "next" }, async (e) => e);
  await wait(60);
  expect(notices($)).toHaveLength(1);
});

test("an open question is flagged for the Notification hook until its call ends", async () => {
  const $ = withFork(null, { messages: asked });
  const open = () =>
    [...$.files].some(([f, t]) => f.endsWith(".question") && t === "open");
  let during;
  await registered()["tool.call"](
    $,
    { tool: "AskUserQuestion", input: {} },
    async () => {
      during = open();
      return { result: "x" };
    },
  );
  expect(during).toBe(true);
  expect(open()).toBe(false);
  await registered({ notify_desktop: false })["tool.call"](
    $,
    { tool: "AskUserQuestion", input: {} },
    async () => {
      during = open();
      return { result: "x" };
    },
  );
  expect(during).toBe(false);
});

test("an answered question cancels its reminder", async () => {
  const $ = withFork(null, { messages: asked });
  const on = withReminder(20);
  await on["tool.call"](
    $,
    { tool: "AskUserQuestion", input: {} },
    async () => ({ result: "x" }),
  );
  await wait(60);
  expect(notices($)).toHaveLength(1);
});

test("the notification falls back to osascript", async () => {
  const $ = withFork(null, { messages: asked, noNotifier: true });
  await registered({ notify_desktop: true })["turn.complete"](
    $,
    {},
    async () => ({}),
  );
  const last = notices($).at(-1);
  expect(last[0]).toBe("osascript");
  expect(last[2]).toContain('display notification "fix the build | s1 |');
});

test("a fork that never answers does not hold the compaction", async () => {
  const $ = withFork(() => new Promise(() => {}), {
    env: { DOTCLAUDE_DEBUG: "1" },
  });
  const on = {};
  register(
    (name, hook) => {
      on[name] = hook;
    },
    { context_compaction_handoff: true },
    5,
  );
  const done = { messages: [] };
  const out = await on["session.compact"](
    $,
    { trigger: "auto" },
    async () => done,
  );
  expect(out).toBe(done);
  expect(handoffFiles($)).toHaveLength(0);
  const log = [...$.files].find(([f]) => f.endsWith("handoff.log"));
  expect(log[1]).toContain("fork timed out");
});

test("a failed note write still appends the row", async () => {
  const $ = withFork(async () => ({ isAnswered: true, text: "## Goal\nkeep" }));
  const write = $.fs.write;
  $.fs.write = async (file, text) => {
    if (file.includes("/.claude/handoffs/")) throw new Error("disk full");
    return write(file, text);
  };
  const on = registered({ context_compaction_handoff: true });
  const out = await on["session.compact"]($, { trigger: "auto" }, async () => ({
    messages: [],
  }));
  expect(out.messages).toHaveLength(1);
  expect(out.messages[0].text).toContain("keep");
  expect(handoffFiles($)).toHaveLength(0);
});

test("a prompt clears the permission notice marker", async () => {
  const on = registered();
  const $ = fake();
  const marker = noticeFile(await modIo($, {}, {}), "s1");
  $.files.set(marker, "seq");
  await on["prompt.submit"]($, { text: "go" }, async (e) => e);
  expect($.files.get(marker) ?? "").toBe("");
});

/** A fake with a marker, and a `tool.check` that asks for the calls in `ask`. */
async function dialogs(ask) {
  const on = registered();
  const $ = fake();
  const marker = noticeFile(await modIo($, {}, {}), "s1");
  $.files.set(marker, "seq");
  for (const id of ask)
    await on["tool.check"]($, { tool: "Bash", tool_use_id: id }, async () => ({
      decision: "ask",
    }));
  // The hook does not wait for the clear, so the test lets it settle.
  const decided = async (id) => {
    await on["telemetry.log"](
      $,
      {
        to: "collector",
        event: "tool_decision",
        attributes: { tool_use_id: id },
      },
      async (e) => e,
    );
    await new Promise((done) => setTimeout(done, 5));
  };
  const call = (id, result = { result: "x" }) =>
    on["tool.call"](
      $,
      { tool: "Bash", tool_use_id: id, command: "ls" },
      async () => result,
    );
  return { on, $, marker, decided, call };
}

test("a parallel tool that ends does not clear the marker of an open dialog", async () => {
  const { $, marker, call } = await dialogs(["a"]);
  await call("b");
  expect($.files.get(marker)).toBe("seq");
});

test("a tool decision clears the marker before the tool call ends", async () => {
  const { $, marker, decided } = await dialogs(["a", "b"]);
  await decided("a");
  expect($.files.get(marker)).toBe("seq");
  await decided("b");
  expect($.files.get(marker) ?? "").toBe("");
});

test("the end of a tool call clears the marker when no decision record came", async () => {
  const { $, marker, call } = await dialogs(["a"]);
  await call("a");
  expect($.files.get(marker) ?? "").toBe("");
});

test("a denied tool call also ends its dialog", async () => {
  const { $, marker, call } = await dialogs(["a"]);
  await call("a", { isError: true, result: "no" });
  expect($.files.get(marker) ?? "").toBe("");
});

test("the end of a main turn clears the marker and the open dialogs", async () => {
  const { on, $, marker, decided } = await dialogs(["a"]);
  await on["turn.complete"]($, {}, async () => ({}));
  expect($.files.get(marker) ?? "").toBe("");
  // A later dialog is the only one that waits, so its decision clears the
  // new marker.
  $.files.set(marker, "seq");
  await on["tool.check"]($, { tool: "Bash", tool_use_id: "c" }, async () => ({
    decision: "ask",
  }));
  await decided("c");
  expect($.files.get(marker) ?? "").toBe("");
});

test("the end of a subagent turn keeps the marker", async () => {
  const { on, $, marker } = await dialogs(["a"]);
  await on["turn.complete"]($, { agentId: "x" }, async () => ({}));
  expect($.files.get(marker)).toBe("seq");
});

test("a dialog is not tracked when notify_desktop is off", async () => {
  const on = registered({ notify_desktop: false });
  const $ = fake();
  const marker = noticeFile(
    await modIo($, { notify_desktop: false }, {}),
    "s1",
  );
  $.files.set(marker, "seq");
  await on["tool.check"]($, { tool: "Bash", tool_use_id: "a" }, async () => ({
    decision: "ask",
  }));
  await on["telemetry.log"](
    $,
    {
      to: "collector",
      event: "tool_decision",
      attributes: { tool_use_id: "a" },
    },
    async (e) => e,
  );
  expect($.files.get(marker)).toBe("seq");
});

test("telemetry records and verdicts pass through unchanged", async () => {
  const { on, $, decided } = await dialogs([]);
  const verdict = { decision: "ask", reason: "r" };
  expect(
    await on["tool.check"](
      $,
      { tool: "Bash", tool_use_id: "z" },
      async () => verdict,
    ),
  ).toBe(verdict);
  const next = async (e) => ({ value: e });
  for (const e of [
    { to: "collector", event: "other", attributes: {} },
    { to: "collector", event: "tool_decision" },
    null,
    {
      to: "collector",
      event: "tool_decision",
      get attributes() {
        throw new Error("x");
      },
    },
  ]) {
    const out = await on["telemetry.log"]($, e, next);
    expect(out.value).toBe(e);
  }
  await decided(undefined);
});

test("a failed session lookup never changes a tool result or a prompt", async () => {
  const on = registered();
  const $ = fake();
  $.session.id = async () => {
    throw new Error("no session");
  };
  const result = { result: "x" };
  const out = await on["tool.call"](
    $,
    { tool: "Bash", tool_use_id: "t", command: "ls" },
    async () => result,
  );
  expect(out.result).toBe("x");
  const ask = await on["tool.call"](
    $,
    { tool: "AskUserQuestion", tool_use_id: "q" },
    async () => result,
  );
  expect(ask.result).toBe("x");
  const prompt = { text: "go" };
  expect(await on["prompt.submit"]($, prompt, async (e) => e)).toStrictEqual(
    prompt,
  );
  const turn = { text: "done" };
  expect(await on["turn.complete"]($, turn, async () => turn)).toBe(turn);
});
