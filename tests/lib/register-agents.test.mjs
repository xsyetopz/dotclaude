// The agent events of the hooks module (`agent.spawn` and `turn.step`) and
// the session facts that the module keeps in state files, over a fake `on`
// and a fake `$`.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { agentContextFile, compactionsFile } from "../../hooks/lib/_io-mod.mjs";
import { modIo } from "../../hooks/register.mjs";
import { isolatedHook, tmp } from "../support/hooks.mjs";
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

test("the module reads the count of compactions from its state file", async () => {
  const $ = fake();
  const facts = await factsOf($);
  expect(await facts.compactions()).toBe(null);
  const io = await modIo($, {}, {});
  $.files.set(compactionsFile(io, "s1"), "4");
  expect(await facts.compactions()).toBe(4);
  $.files.set(compactionsFile(io, "s1"), "two");
  expect(await facts.compactions()).toBe(null);
});

/** Run the compact SessionStart hook on a transcript with `boundaries`. */
function compactStart(data, boundaries, input = {}) {
  const row = JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    isSidechain: false,
  });
  const transcript = path.join(tmp("dotclaude-transcript-"), "main.jsonl");
  fs.writeFileSync(transcript, `${row}\n`.repeat(boundaries));
  isolatedHook(
    "session-start/restore-context-after-compact.mjs",
    {
      session_id: "s/1",
      source: "compact",
      transcript_path: transcript,
      ...input,
    },
    {
      CLAUDE_PLUGIN_DATA: data,
      CLAUDE_PLUGIN_OPTION_CONTEXT_COMPACT_CARRYOVER: "false",
    },
  );
}

test("the compact SessionStart hook keeps the count of compactions", () => {
  const data = tmp("dotclaude-data-");
  const io = { platform: "posix", env: { CLAUDE_PLUGIN_DATA: data } };
  const kept = () => fs.readFileSync(compactionsFile(io, "s/1"), "utf8");
  // The transcript already has the new boundary.
  compactStart(data, 2);
  expect(kept()).toBe("2");
  // The transcript does not have the new boundary yet.
  compactStart(data, 2);
  expect(kept()).toBe("3");
  // A compaction without the hook leaves the transcript ahead.
  compactStart(data, 6);
  expect(kept()).toBe("6");
});

test("the SessionStart hook keeps no count for a subagent or another source", () => {
  const data = tmp("dotclaude-data-");
  compactStart(data, 2, { source: "resume" });
  compactStart(data, 2, { agent_id: "a1", agent_type: "x" });
  expect(fs.existsSync(path.join(data, "sessions"))).toBe(false);
});
