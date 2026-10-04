import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "../hooks/register.mjs";

const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

/** A fake of the engine's `$`. It is a test double, not the real engine. */
function engine({ report = "[]", scanFails = false } = {}) {
  const calls = [];
  return {
    calls,
    $: {
      session: { cwd: async () => "/work/app", root: async () => "/work/app" },
      env: { get: async (name) => ({ HOME: "/home/u" })[name] },
      fs: {
        read: async () => {
          throw new Error("missing");
        },
      },
      process: {
        run: async (argv, init) => {
          calls.push({ argv, init });
          if (scanFails) throw new Error("not found");
          return { exitCode: 0, stdout: report, stderr: "" };
        },
      },
    },
  };
}

function load(options = {}) {
  const handlers = {};
  register((event, fn) => {
    handlers[event] = fn;
  }, options);
  return handlers;
}

/** Runs `tool.call` with a `next` that asks `tool.check`, as the engine does. */
async function call(handlers, $, e, result = { result: "ok" }) {
  let verdict;
  const r = await handlers["tool.call"](
    $,
    { tool_use_id: "t1", ...e },
    async () => {
      verdict = await handlers["tool.check"](
        $,
        e && { tool_use_id: "t1", ...e },
        async () => ({ decision: "allow" }),
      );
      return result;
    },
  );
  return { r, verdict };
}

test("hooks.json names the module, SessionStart, and Stop", () => {
  const json = JSON.parse(
    readFileSync(join(import.meta.dir, "../hooks/hooks.json"), "utf8"),
  );
  expect(json.modules).toEqual(["./register.mjs"]);
  expect(Object.keys(json.hooks).sort()).toEqual(["SessionStart", "Stop"]);
  expect(typeof json.description).toBe("string");
});

test("a destructive Bash command gives an ask with its reason", async () => {
  const { $ } = engine();
  const { verdict } = await call(load(), $, {
    tool: "Bash",
    command: "git push --force",
  });
  expect(verdict.decision).toBe("ask");
  expect(verdict.reason).toContain("`git push --force`");
});

test("a safe Bash command keeps the engine verdict", async () => {
  const { $ } = engine();
  const { verdict } = await call(load(), $, {
    tool: "Bash",
    command: "git status",
  });
  expect(verdict.decision).toBe("allow");
});

test("the ask does not outlive the call", async () => {
  const { $ } = engine();
  const h = load();
  await call(h, $, { tool: "Bash", command: "git reset --hard" });
  const after = await h["tool.check"]($, { tool_use_id: "t1" }, async () => ({
    decision: "allow",
  }));
  expect(after.decision).toBe("allow");
});

test("an edit of a settings file asks", async () => {
  const { $ } = engine();
  const { verdict } = await call(load(), $, {
    tool: "Edit",
    file_path: "/p/.claude/settings.json",
    old_string: "a",
    new_string: "b",
  });
  expect(verdict.decision).toBe("ask");
});

test("an option set to false turns a guard off", async () => {
  const { $ } = engine();
  const { verdict } = await call(load({ guard_bash: false }), $, {
    tool: "Bash",
    command: "git reset --hard",
  });
  expect(verdict.decision).toBe("allow");
});

test("a secret in a result is redacted and the model gets a note", async () => {
  const { $, calls } = engine({
    report: JSON.stringify([{ RuleID: "github-pat", Secret: SECRET }]),
  });
  const { r } = await call(
    load(),
    $,
    { tool: "Bash", command: "env" },
    { result: `TOKEN=${SECRET}` },
  );
  expect(r.result).toBe("TOKEN=[REDACTED:github-pat]");
  expect(r.context[0]).toContain("redacted 1 secret");
  expect(calls[0].argv[0]).toBe("betterleaks");
  expect(calls[0].init.stdin).toContain(SECRET);
});

test("a result passes unchanged when Betterleaks is missing", async () => {
  const { $ } = engine({ scanFails: true });
  const result = { result: `TOKEN=${SECRET}` };
  const { r } = await call(load(), $, { tool: "Bash", command: "env" }, result);
  expect(r).toBe(result);
});

test("a denied call and a failed call are not scanned", async () => {
  const { $, calls } = engine();
  const h = load();
  const denied = { deny: "no" };
  expect(await h["tool.call"]($, { tool: "Read" }, async () => denied)).toBe(
    denied,
  );
  const failed = { isError: true, result: "x" };
  expect(await h["tool.call"]($, { tool: "Read" }, async () => failed)).toBe(
    failed,
  );
  expect(calls).toHaveLength(0);
});
