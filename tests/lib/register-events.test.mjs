// The PostToolUseFailure, UserPromptSubmit, and PreCompact actions in the
// hooks module, over a fake `on` and a small fake of the engine's `$`. The
// tests give each command as a string. They never run a guarded command.

import { expect, test } from "bun:test";
import { compactionsFile } from "../../hooks/lib/_io-mod.mjs";
import { modIo } from "../../hooks/register.mjs";
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
  expect(seen).toEqual([e]);
  expect(ledger($)?.prompts).toEqual(["first ask"]);
});

test("a precompute saves nothing and continues", async () => {
  const on = registered();
  const $ = fake({ messages: [typed("first ask")] });
  const e = { trigger: "precompute", messages: [] };
  const out = await on["session.compact"]($, e, async () => ({ skip: "x" }));
  expect(out).toEqual({ skip: "x" });
  expect(ledger($)).toBeNull();
});
