// The PostToolUseFailure, UserPromptSubmit, and PreCompact actions in the
// hooks module, over a fake `on` and a small fake of the engine's `$`. The
// tests give each command as a string. They never run a guarded command.

import { expect, test } from "bun:test";
import { compactionsFile } from "../../hooks/lib/_io-mod.mjs";
import {
  COMPACT_HANDOFF_TEXT,
  COMPACT_TEXT,
  modIo,
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
  const on = registered();
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
