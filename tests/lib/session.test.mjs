// The session facts of the Node io and the pure transcript parsers that they
// share with the classic hooks.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";
import {
  compactionsFromText,
  contextFromText,
  mainContextFromText,
  nestedFromText,
  promptsFromText,
  stoppedAtLimitInText,
  turnsFromText,
} from "../../hooks/lib/_transcript-parse.mjs";
import { tmp } from "../support/hooks.mjs";

const jsonl = (...entries) =>
  `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;

const prompt = (content, extra = {}) => ({
  type: "user",
  message: { content },
  ...extra,
});

const call = (id, input, extra = {}) => ({
  type: "assistant",
  message: {
    id,
    usage: {
      input_tokens: input,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 10,
    },
  },
  ...extra,
});

const toolResult = {
  type: "user",
  message: { content: [{ type: "tool_result", content: "ok" }] },
};

/** A session folder with a main transcript and one subagent transcript. */
function session(main, agent) {
  const dir = tmp("dotclaude-session-");
  const transcript = path.join(dir, "s1.jsonl");
  fs.writeFileSync(transcript, main);
  const agentFile = path.join(dir, "s1", "subagents", "agent-a1.jsonl");
  if (agent !== undefined) {
    fs.mkdirSync(path.dirname(agentFile), { recursive: true });
    fs.writeFileSync(agentFile, agent);
  }
  return {
    agentFile,
    data: { session_id: "s1", agent_id: "a1", transcript_path: transcript },
  };
}

test("lastPrompt gives the last typed prompt, cut at 4000 characters", async () => {
  const long = "x".repeat(4100);
  const { data } = session(
    jsonl(
      prompt("first"),
      prompt(long),
      prompt("a reminder", { isMeta: true }),
      prompt("from an agent", { isSidechain: true }),
      prompt("<command-name>/clear</command-name>"),
    ),
  );
  expect(await nodeIo(data).session.lastPrompt()).toBe(
    `${"x".repeat(4000)} [...]`,
  );
  const { data: short } = session(jsonl(prompt("remove the test")));
  expect(await nodeIo(short).session.lastPrompt()).toBe("remove the test");
});

test("each fact gives its do-not-know value without a transcript", async () => {
  const facts = nodeIo({}).session;
  expect(await facts.lastPrompt()).toBe("");
  expect(await facts.agentTranscriptPath()).toBe("");
  expect(await facts.agentTurns()).toBe(null);
  expect(await facts.agentContext()).toBe(null);
  expect(await facts.loadedNested()).toBe(null);
  expect(await facts.mainContextTokens()).toBe(null);
  expect(await facts.compactions()).toBe(null);
  expect(await facts.agentStoppedAtLimit("a1")).toBe(null);
  const missing = {
    session_id: "s1",
    agent_id: "a1",
    transcript_path: path.join(tmp("dotclaude-none-"), "s1.jsonl"),
  };
  const gone = nodeIo(missing).session;
  expect(await gone.lastPrompt()).toBe("");
  expect(await gone.agentTurns()).toBe(null);
  expect(await gone.agentContext()).toBe(null);
  expect(await gone.loadedNested()).toBe(null);
  expect(await gone.mainContextTokens()).toBe(null);
  expect(await gone.compactions()).toBe(null);
  expect(await gone.agentStoppedAtLimit("a1")).toBe(null);
  // An input field of an unexpected type gives the do-not-know values too.
  const odd = nodeIo({ ...missing, transcript_path: 42 }).session;
  expect(await odd.lastPrompt()).toBe("");
  expect(await odd.agentTranscriptPath()).toBe("");
  expect(await odd.agentTurns()).toBe(null);
  expect(await odd.loadedNested()).toBe(null);
  expect(await odd.compactions()).toBe(null);
  expect(await odd.agentStoppedAtLimit("a1")).toBe(null);
  // A fact that throws gives its do-not-know value, and does not reject.
  const broken = nodeIo({
    ...missing,
    get session_id() {
      throw new Error("bad input");
    },
  }).session;
  expect(await broken.agentTranscriptPath()).toBe("");
  expect(await broken.agentTurns()).toBe(null);
  expect(await broken.agentContext()).toBe(null);
});

test("the agent facts read the subagent transcript next to the session", async () => {
  const { data, agentFile } = session(
    jsonl(prompt("start")),
    jsonl(
      prompt("brief"),
      call("m1", 5000),
      toolResult,
      call("m2", 9000),
      // A SendMessage resume starts the turn count again.
      prompt("more", { isMeta: true, origin: { kind: "coordinator" } }),
      call("m3", 12_000),
      call("m3", 12_000),
      prompt("a reminder", { isMeta: true }),
      call("m4", 20_000),
    ),
  );
  const facts = nodeIo(data).session;
  expect(await facts.agentTranscriptPath()).toBe(agentFile);
  expect(await facts.agentTurns()).toBe(2);
  expect(await facts.agentContext()).toEqual({ first: 6010, last: 21_010 });
  // The main conversation has no agent facts.
  const main = nodeIo({ ...data, agent_id: undefined }).session;
  expect(await main.agentTranscriptPath()).toBe("");
  expect(await main.agentTurns()).toBe(null);
});

test("the main facts read nested memory and the main context", async () => {
  const { data } = session(
    jsonl(
      prompt("start"),
      {
        type: "attachment",
        attachment: { type: "nested_memory", path: "/p/sub/CLAUDE.md" },
      },
      call("m1", 40_000),
      call("m2", 7, { isSidechain: true }),
    ),
  );
  const facts = nodeIo(data).session;
  expect([...(await facts.loadedNested())]).toEqual(["/p/sub/CLAUDE.md"]);
  expect(await facts.mainContextTokens()).toBe(41_010);
});

test("the pure parsers read text and give the same results", () => {
  const text = jsonl(prompt("brief"), call("m1", 0), toolResult, call("m2", 0));
  expect(turnsFromText(text)).toBe(2);
  expect(turnsFromText("")).toBe(0);
  expect(contextFromText(text)).toEqual({ first: 1010, last: 1010 });
  expect(contextFromText("not json\n")).toBe(null);
});

const boundary = (postTokens) => ({
  type: "system",
  subtype: "compact_boundary",
  compactMetadata: { postTokens },
});

test("a compaction after the last response gives the size after it", async () => {
  const { data } = session(jsonl(call("m1", 150_000), boundary(20_000)));
  expect(await nodeIo(data).session.mainContextTokens()).toBe(20_000);
  // A later response gives its own input again.
  const { data: later } = session(
    jsonl(call("m1", 150_000), boundary(20_000), call("m2", 30_000)),
  );
  expect(await nodeIo(later).session.mainContextTokens()).toBe(31_010);
});

test("the parsers skip a cut first line, a malformed line, and a null line", () => {
  const whole = JSON.stringify({
    type: "attachment",
    attachment: { type: "nested_memory", path: "/p/a/CLAUDE.md" },
  });
  // A tail read starts in the middle of a line.
  const cut = `${whole.slice(20)}\n`;
  const text = `${cut}{"type": broken\nnull\n42\n${jsonl(
    prompt("brief"),
    {
      type: "attachment",
      attachment: { type: "nested_memory", path: "/p/b/CLAUDE.md" },
    },
    call("m1", 5000),
    boundary(9000),
  )}null\n"text"\n`;
  expect(promptsFromText(text, 1)).toEqual(["brief"]);
  expect(turnsFromText(text)).toBe(1);
  expect(contextFromText(text)).toEqual({ first: 6010, last: 6010 });
  expect(mainContextFromText(text)).toBe(9000);
  expect([...nestedFromText(text)]).toEqual(["/p/b/CLAUDE.md"]);
  expect(compactionsFromText(text)).toBe(1);
  expect(
    turnsFromText(`${text}{"type":"user","message":{"content":[null]}}\n`),
  ).toBe(0);
});

test("compactions counts the compact_boundary entries of the main transcript", async () => {
  const quoted = prompt('He wrote "subtype":"compact_boundary" here');
  const { data } = session(
    jsonl(
      prompt("start"),
      boundary(10_000),
      quoted,
      call("m1", 50_000),
      boundary(12_000),
    ),
  );
  expect(await nodeIo(data).session.compactions()).toBe(2);
  const { data: none } = session(jsonl(prompt("start"), call("m1", 9)));
  expect(await nodeIo(none).session.compactions()).toBe(0);
});

const notification = (id, status) =>
  prompt(
    `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>${status}</summary>\n</task-notification>`,
  );

test("agentStoppedAtLimit reads the task notifications of the agent", async () => {
  const { data } = session(
    jsonl(
      notification("a1", 'Agent "x" stopped at its 80-turn limit'),
      notification("a2", 'Agent "y" completed'),
    ),
  );
  const facts = nodeIo(data).session;
  expect(await facts.agentStoppedAtLimit("a1")).toBe(true);
  expect(await facts.agentStoppedAtLimit("a2")).toBe(false);
  expect(await facts.agentStoppedAtLimit("a3")).toBe(false);
  expect(stoppedAtLimitInText("", "a1")).toBe(false);
});
