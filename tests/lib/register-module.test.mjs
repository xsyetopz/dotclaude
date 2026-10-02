// The hooks module over a fake `on` and a small fake of the engine's `$`.
// The tests give each command as a string in the `tool.call` input. They
// never run a guarded command.

import { expect, test } from "bun:test";
import { register } from "../../hooks/register.mjs";

const enoent = (file) =>
  Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });

/**
 * A fake `$`. Files are a map from path to text. `betterleaks` reports each
 * secret in `init.secrets`, and each other command exits with 1.
 */
function fake(init = {}) {
  const files = new Map(Object.entries(init.files ?? {}));
  const env = { HOME: "/home/u", ...init.env };
  const $ = {
    plugin: { name: "dotclaude", root: "/plugins/dotclaude" },
    env: { get: async (name) => env[name] },
    fs: {
      read: async (file) => {
        if (init.fsFails) throw new TypeError("fs failed");
        if (!files.has(file)) throw enoent(file);
        return files.get(file);
      },
      write: async (file, text) => {
        if (init.fsFails) throw new TypeError("fs failed");
        files.set(file, text);
      },
      exists: async (file) => files.has(file),
      stat: async (file) => {
        if (init.fsFails) throw new TypeError("fs failed");
        if (!files.has(file)) throw enoent(file);
        return { kind: "file", size: 1, mtimeMs: 5, isLink: false };
      },
      list: async () => [],
    },
    process: {
      run: async (argv) => {
        const leaks = argv[0] === "betterleaks";
        const report = (init.secrets ?? []).map((secret) => ({
          Secret: secret,
          RuleID: "generic-api-key",
        }));
        return {
          exitCode: leaks ? 0 : 1,
          stdout: leaks ? JSON.stringify(report) : "",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        };
      },
    },
    session: {
      id: async () => "s1",
      cwd: async () => "/work",
      root: async () => "/work",
      messages: async () => init.messages ?? [],
      usage: async () => ({ startedAt: 0, context: { window: 200000 } }),
    },
    agent: { list: async () => init.agents ?? [] },
  };
  return $;
}

/** The handlers that `register` gives to a fake `on`, by event name. */
function registered() {
  const handlers = {};
  register((name, hook) => {
    handlers[name] = hook;
  }, {});
  return handlers;
}

/** A `next` that records its inputs and resolves `result`. */
function nextOf(result, inside = async () => {}) {
  const calls = [];
  const next = async (e) => {
    calls.push(e);
    await inside(e);
    return result;
  };
  return { next, calls };
}

test("a destructive Bash command gives a deny and does not call next", async () => {
  const on = registered();
  const { next, calls } = nextOf({ result: "ran" });
  const out = await on["tool.call"](
    fake(),
    { tool: "Bash", tool_use_id: "t1", command: "rm -rf ~" },
    next,
  );
  expect(Object.keys(out)).toEqual(["deny"]);
  expect(out.deny).toStartWith("[dotclaude]");
  expect(calls).toEqual([]);
});

test("tool.check gives the ask of the same call, and an engine deny wins", async () => {
  const on = registered();
  const $ = fake();
  const engine = { decision: "allow" };
  const denied = { decision: "deny", reason: "rule" };
  const checks = [];
  const check = (id, verdict = engine) =>
    on["tool.check"](
      $,
      { tool: "Bash", input: {}, tool_use_id: id },
      async () => verdict,
    );
  const { next } = nextOf({ result: "ok" }, async () => {
    checks.push(await check("other"));
    checks.push(await check("t2"));
    checks.push(await check("t2"));
    checks.push(await check("t2", denied));
  });
  const out = await on["tool.call"](
    $,
    { tool: "Bash", tool_use_id: "t2", command: "git push --force" },
    next,
  );
  expect(checks[0]).toBe(engine);
  expect(checks[1].decision).toBe("ask");
  expect(checks[1].reason).toBeString();
  expect(checks[2].decision).toBe("ask");
  expect(checks[3]).toBe(denied);
  expect(out.result).toBe("ok");
  expect(await check("t2")).toBe(engine);
});

test("an allow of an action leaves the verdict to the engine", async () => {
  const on = registered();
  const $ = fake();
  const denied = { decision: "deny", reason: "rule" };
  const checks = [];
  const { next, calls } = nextOf({ result: "ok" }, async (e) => {
    checks.push(
      await on["tool.check"](
        $,
        { tool: "Agent", input: {}, tool_use_id: e.tool_use_id },
        async () => denied,
      ),
    );
  });
  await on["tool.call"](
    $,
    {
      tool: "Agent",
      tool_use_id: "t7",
      subagent_type: "dotclaude:implementer",
      prompt: "x",
    },
    next,
  );
  expect(calls[0].run_in_background).toBe(false);
  expect(checks).toEqual([denied]);
});

test("a redaction replaces the result and drops the core messages", async () => {
  const on = registered();
  const secret = "sk_live_0123456789abcdef";
  const { next } = nextOf({
    result: { stdout: `key=${secret}` },
    ref: { id: "r1" },
    text: "core text",
    isReadOnly: true,
  });
  const out = await on["tool.call"](
    fake({ secrets: [secret] }),
    { tool: "Bash", tool_use_id: "t3", command: "printenv KEY" },
    next,
  );
  expect(Object.keys(out).toSorted()).toEqual(["context", "result"]);
  expect(out.result).toEqual({ stdout: "key=[REDACTED:generic-api-key]" });
});

test("an additionalContext of an action goes after the context of core", async () => {
  const on = registered();
  const secret = "sk_live_0123456789abcdef";
  const { next } = nextOf({ result: secret, context: ["from core"] });
  const out = await on["tool.call"](
    fake({ secrets: [secret] }),
    { tool: "Read", tool_use_id: "t4", file_path: "/work/.env" },
    next,
  );
  expect(out.context).toHaveLength(2);
  expect(out.context[0]).toBe("from core");
  expect(out.context[1]).toStartWith("[dotclaude] This hook redacted 1 secret");
});

test("an added context gives a new result without the core messages", async () => {
  const on = registered();
  const id = "a1b2c3d4";
  const note = `<task-notification>\n<task-id>${id}</task-id>\n<summary>Agent "x" stopped at its 80-turn limit</summary>\n</task-notification>`;
  const { next } = nextOf({ result: "sent", ref: 7, text: "core text" });
  const out = await on["tool.call"](
    fake({ messages: [{ text: note }] }),
    { tool: "SendMessage", tool_use_id: "t8", to: id, message: "go on" },
    next,
  );
  // A kept `ref` makes core use its own messages, without the context.
  expect(Object.keys(out).toSorted()).toEqual(["context", "result"]);
  expect(out.context.at(-1)).toContain("handoff report");
});

test("an action that throws does not stop the call or the other actions", async () => {
  const on = registered();
  const { next, calls } = nextOf({ result: "ok" });
  const e = { tool: "Read", tool_use_id: "t5", file_path: "/work/a.txt" };
  const out = await on["tool.call"](fake({ fsFails: true }), e, next);
  expect(calls).toEqual([e]);
  expect(out).toEqual({ result: "ok" });
  const deny = await on["tool.call"](
    fake({ fsFails: true }),
    { tool: "Bash", tool_use_id: "t6", command: "rm -rf ~" },
    nextOf({ result: "ran" }).next,
  );
  expect(deny.deny).toStartWith("[dotclaude]");
});
