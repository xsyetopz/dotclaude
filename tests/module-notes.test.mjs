import { expect, test } from "bun:test";
import { join } from "node:path";
import { CACHE_TTL_MS } from "../hooks/lib/_budget.mjs";
import { register } from "../hooks/register.mjs";

const ROOT = join(import.meta.dir, "..");

/** A fake of the engine's `$`. It is a test double, not the real engine. */
function engine({ fork = { isAnswered: true, text: "## Goal\nx" } } = {}) {
  const files = {};
  const store = {};
  return {
    files,
    store,
    $: {
      plugin: { root: ROOT },
      session: { root: async () => "/work/app", id: async () => "s1" },
      // A fake environment with no account, so the plan is `unknown`.
      env: {
        get: async (name) => (name === "HOME" ? "/nonexistent" : undefined),
      },
      fs: {
        read: async (path) => files[path] ?? Bun.file(path).text(),
        write: async (path, text) => {
          files[path] = text;
        },
      },
      store: {
        get: async (k) => store[k],
        set: async (k, v) => {
          store[k] = v;
        },
      },
      model: { fork: async () => fork },
    },
  };
}

function load(options = {}) {
  const h = {};
  register((event, fn) => {
    h[event] = fn;
  }, options);
  return h;
}

const pass = async (e) => e;

test("a call model that differs from the pinned model is denied, not removed", async () => {
  const { $ } = engine();
  const r = await load()["agent.spawn"](
    $,
    { subagentType: "dotclaude:debugger", model: "opus" },
    pass,
  );
  expect(r.deny).toContain("claude-sonnet-5-5");
  expect(r.deny).toContain("Omit `model`");
});

test("a call with no model, or the pinned model by alias, passes unchanged", async () => {
  const { $ } = engine();
  const h = load();
  for (const model of [undefined, "sonnet", "claude-sonnet-5-5"]) {
    const e = { subagentType: "dotclaude:debugger", model };
    expect(await h["agent.spawn"]($, e, pass)).toBe(e);
  }
});

test("Fable 5.1 is never allowed for a subagent", async () => {
  const { $ } = engine();
  const r = await load()["agent.spawn"](
    $,
    { subagentType: "my-agent", model: "fable", parentModel: "fable" },
    pass,
  );
  expect(r.deny).toContain("`opus-5-5`, `sonnet-5-5`, `haiku-4-5`");
});

test("an agent with no model runs on the model of its caller", async () => {
  const { $ } = engine();
  const h = load();
  const e = { subagentType: "my-agent", parentModel: "claude-fable-5-1" };
  expect((await h["agent.spawn"]($, e, pass)).deny).toContain("fable-5-1");
  const ok = { subagentType: "my-agent", parentModel: "claude-opus-5-5" };
  expect(await h["agent.spawn"]($, ok, pass)).toBe(ok);
});

test("an effort outside the model's list is denied with the allowed values", async () => {
  const { $ } = engine();
  const h = load();
  const sonnet = await h["agent.spawn"](
    $,
    { subagentType: "x", model: "sonnet", effort: "high" },
    pass,
  );
  expect(sonnet.deny).toContain("`low`, `medium`");
  const haiku = await h["agent.spawn"](
    $,
    { subagentType: "x", model: "haiku", effort: "low" },
    pass,
  );
  expect(haiku.deny).toContain("no effort");
  const opus = { subagentType: "x", model: "opus", effort: "high" };
  expect(await h["agent.spawn"]($, opus, pass)).toBe(opus);
});

test("the compaction adds the open-request instruction and a handoff note", async () => {
  const { $, files } = engine();
  let given;
  const r = await load()["session.compact"](
    $,
    { trigger: "auto", instructions: "Focus." },
    async (e) => {
      given = e;
      return { messages: [{ role: "user", text: "summary" }] };
    },
  );
  expect(given.instructions).toStartWith("Focus.");
  expect(given.instructions).toContain("still open");
  expect(given.instructions).toContain("waits for the user");
  const [path] = Object.keys(files);
  expect(path).toMatch(
    /^\/work\/app\/\.claude\/handoffs\/\d{4}-\d{2}-\d{2}-\d{4}-compaction\.md$/,
  );
  expect(files[path]).toContain("status: in-progress");
  const row = r.messages.at(-1).text;
  expect(row).toContain(path);
  expect(row).toContain("Do not continue the task");
  expect(row).toContain("run `/clear`");
  expect(row).toContain(
    `Continue from the handoff note at \`.claude/handoffs/${path.split("/").pop()}\`.`,
  );
});

test("a second compaction supersedes the earlier note of the session", async () => {
  const { $, files, store } = engine();
  const h = load();
  const next = async () => ({ messages: [] });
  const old = "/work/app/.claude/handoffs/2026-10-04-0000-compaction.md";
  const other = "/work/app/.claude/handoffs/2026-10-04-0001-compaction.md";
  files[old] =
    "---\nstatus: in-progress\nwritten: x\n---\n\nstatus: in-progress\n";
  files[other] = files[old];
  store["handoff-notes"] = { s1: old, s2: other };
  await h["session.compact"]($, { trigger: "auto" }, next);
  expect(files[old]).toBe(
    "---\nstatus: superseded\nwritten: x\n---\n\nstatus: in-progress\n",
  );
  expect(files[other]).toContain("status: in-progress");
  const newest = store["handoff-notes"].s1;
  expect(newest).not.toBe(old);
  expect(files[newest]).toContain("status: in-progress");
  expect(Object.keys(store["handoff-notes"])).toEqual(["s2", "s1"]);
});

test("a failed fork, a subagent, a precompute, and a manual compact without a note", async () => {
  const none = engine({ fork: { isAnswered: false } });
  const h = load();
  const next = async () => ({ messages: [] });
  expect(
    (await h["session.compact"](none.$, { trigger: "auto" }, next)).messages,
  ).toEqual([]);
  const sub = engine();
  await h["session.compact"](sub.$, { trigger: "auto", agentId: "a1" }, next);
  await h["session.compact"](sub.$, { trigger: "precompute" }, next);
  await h["session.compact"](sub.$, { trigger: "manual" }, next);
  expect(Object.keys(sub.files)).toEqual([]);
});

test("a prompt after the cache TTL gets the cold-cache note", async () => {
  const { $, store } = engine();
  const h = load();
  await h["turn.complete"]($, {}, pass);
  expect(typeof store["last-turn-ms"]).toBe("number");
  const fresh = { text: "go" };
  expect(await h["prompt.submit"]($, fresh, pass)).toBe(fresh);
  store["last-turn-ms"] = Date.now() - CACHE_TTL_MS - 60_000;
  const r = await h["prompt.submit"]($, { text: "go" }, pass);
  expect(r.context[0]).toContain("/clear");
  const mid = await h["prompt.submit"]($, { text: "go", turnId: "t" }, pass);
  expect(mid.context).toBeUndefined();
});

test("a subagent turn does not set the last-turn time", async () => {
  const { $, store } = engine();
  await load()["turn.complete"]($, { agentId: "a1" }, pass);
  expect(store["last-turn-ms"]).toBeUndefined();
});
