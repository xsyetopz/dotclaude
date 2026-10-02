// The agent events of the hooks module (`agent.spawn`, `turn.step`, and
// `session.compact`) and the session facts that they keep, over a fake `on`
// and a fake `$`.

import { expect, test } from "bun:test";
import { agentContextFile, compactionsFile } from "../../hooks/lib/_io-mod.mjs";
import { modIo } from "../../hooks/register.mjs";
import { fake, registered } from "./fake-engine.mjs";

const spawnInput = {
  tool_use_id: "t1",
  prompt: "Fix the bug.",
  description: "fix",
  subagentType: "general-purpose",
  background: false,
  fork: false,
};

/** The session facts of the agent `a1` in the session `s1`. */
const factsOf = async ($, agentId = "a1") =>
  (await modIo($, {}, { session_id: "s1", agent_id: agentId })).session;

const runningMarkers = ($) =>
  [...$.files.keys()].filter((file) => file.endsWith(".running"));

test("agent.spawn puts the conventions before the prompt and marks the agent as running", async () => {
  const on = registered();
  const $ = fake();
  const calls = [];
  const out = await on["agent.spawn"]($, spawnInput, async (e) => {
    calls.push(e);
    expect(runningMarkers($)).toEqual([]);
    return { model: "m", agentId: "a1" };
  });
  expect(out).toEqual({ model: "m", agentId: "a1" });
  expect(calls).toHaveLength(1);
  expect(calls[0].prompt).toStartWith(
    '[dotclaude] <working_conventions source="dotclaude">',
  );
  expect(calls[0].prompt).toEndWith("</context_budget>\n\nFix the bug.");
  expect(calls[0].subagentType).toBe("general-purpose");
  expect(runningMarkers($)).toHaveLength(1);
  expect(runningMarkers($)[0]).toEndWith("/s1.a1.running");
});

test("agent.spawn marks no agent when the spawn is denied or the actions fail", async () => {
  const on = registered();
  const $ = fake();
  const denied = { deny: "no" };
  expect(await on["agent.spawn"]($, spawnInput, async () => denied)).toBe(
    denied,
  );
  expect(runningMarkers($)).toEqual([]);
  // An action that throws fails open: the spawn goes on with its prompt.
  const calls = [];
  const out = await on["agent.spawn"](
    fake({ fsFails: true }),
    spawnInput,
    async (e) => {
      calls.push(e);
      return { model: "m", agentId: "a2" };
    },
  );
  expect(out.agentId).toBe("a2");
  expect(calls[0].prompt).toEndWith("Fix the bug.");
});

/** A `next` of `turn.step` that yields `chunks` and resolves `result`. */
function stepOf(chunks, result) {
  return async function* () {
    for (const chunk of chunks) yield chunk;
    return result;
  };
}

/** Run a `turn.step` hook to its end, and give its chunks and its result. */
async function drain(stream) {
  const chunks = [];
  for (let step = await stream.next(); ; step = await stream.next()) {
    if (step.done) return { chunks, result: step.value };
    chunks.push(step.value);
  }
}

const usage = (input, read, write) => ({
  input_tokens: input,
  output_tokens: 5,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  model: "m",
});

test("turn.step keeps the first and the latest context tokens of a subagent", async () => {
  const on = registered();
  const $ = fake();
  const text = { kind: "text", index: 0, text: "hi" };
  const stop = { kind: "stop", stopReason: "end_turn", usage: usage(1, 2, 3) };
  const first = { answer: "hi", toolUses: [], usage: usage(10, 20, 30) };
  const out = await drain(
    on["turn.step"]($, { agentId: "a1" }, stepOf([text, stop], first)),
  );
  expect(out.chunks).toHaveLength(2);
  expect(out.chunks[0]).toBe(text);
  expect(out.chunks[1]).toBe(stop);
  expect(out.result).toBe(first);
  expect(await (await factsOf($)).agentContext()).toEqual({
    first: 60,
    last: 60,
  });
  const later = { answer: "", toolUses: [], usage: usage(100, 200, 300) };
  await drain(on["turn.step"]($, { agentId: "a1" }, stepOf([], later)));
  expect(await (await factsOf($)).agentContext()).toEqual({
    first: 60,
    last: 600,
  });
  expect(await (await factsOf($, "a2")).agentContext()).toBe(null);
});

test("turn.step on the main thread keeps nothing, and a failed write does not throw", async () => {
  const on = registered();
  const $ = fake();
  const result = { answer: "", toolUses: [], usage: usage(1, 1, 1) };
  await drain(on["turn.step"]($, {}, stepOf([], result)));
  expect([...$.files.keys()]).toEqual([]);
  const chunk = { kind: "text", index: 0, text: "x" };
  const out = await drain(
    on["turn.step"](
      fake({ fsFails: true }),
      { agentId: "a1" },
      stepOf([chunk], result),
    ),
  );
  expect(out.chunks).toEqual([chunk]);
  expect(out.result).toBe(result);
});

test("agentContext gives null for a missing or bad file", async () => {
  const $ = fake();
  const facts = await factsOf($);
  expect(await facts.agentContext()).toBe(null);
  const io = await modIo($, {}, {});
  $.files.set(agentContextFile(io, "s1", "a1"), "{ not json");
  expect(await facts.agentContext()).toBe(null);
  $.files.set(agentContextFile(io, "s1", "a1"), '{"first":3,"last":"x"}');
  expect(await facts.agentContext()).toBe(null);
  $.files.set(agentContextFile(io, "s1", "a1"), '{"first":3,"last":9}');
  expect(await facts.agentContext()).toEqual({ first: 3, last: 9 });
  expect(await (await modIo($, {}, {})).session.agentContext()).toBe(null);
});

test("session.compact counts each compaction of the main conversation", async () => {
  const on = registered();
  const $ = fake();
  const facts = await factsOf($);
  expect(await facts.compactions()).toBe(null);
  const done = { messages: [] };
  const compact = (e, r) => on["session.compact"]($, e, async () => r);
  expect(await compact({ trigger: "auto", messages: [] }, done)).toBe(done);
  expect(await facts.compactions()).toBe(1);
  await compact({ trigger: "manual", messages: [] }, done);
  expect(await facts.compactions()).toBe(2);
  // A skip and a compaction of a subagent do not count.
  const skipped = { skip: "blocked" };
  expect(await compact({ trigger: "auto", messages: [] }, skipped)).toBe(
    skipped,
  );
  await compact({ trigger: "auto", agentId: "a1", messages: [] }, done);
  expect(await facts.compactions()).toBe(2);
  const io = await modIo($, {}, {});
  $.files.set(compactionsFile(io, "s1"), "two");
  expect(await facts.compactions()).toBe(null);
});
