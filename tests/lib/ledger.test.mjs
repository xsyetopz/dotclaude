// The session ledger and the running-agent markers reach the host only
// through `io`. The memory fs below has no `remove` and no rename, as the
// engine io, so the functions that the guards call cannot use them.

import { expect, test } from "bun:test";
import {
  agentStarted,
  agentStopped,
  editedBySession,
  fullReads,
  load,
  readStamp,
  recordRead,
  runningAgents,
  save,
} from "../../hooks/lib/_ledger.mjs";

const DIR = "/data/sessions";

function memoryIo(files = {}, session = {}) {
  const store = new Map(
    Object.entries(files).map(([file, text]) => [
      file,
      { text, mtimeMs: 1000 },
    ]),
  );
  const missing = (file) => Object.assign(new Error(file), { code: "ENOENT" });
  return {
    store,
    platform: "posix",
    env: { CLAUDE_PLUGIN_DATA: "/data" },
    home: "/home/u",
    tmp: "/tmp",
    cwd: "/work",
    fs: {
      read: async (file) => {
        if (!store.has(file)) throw missing(file);
        return store.get(file).text;
      },
      write: async (file, text) => {
        store.set(file, { text, mtimeMs: 1000 });
      },
      exists: async (file) => store.has(file),
      stat: async (file) => {
        if (!store.has(file)) throw missing(file);
        const { text, mtimeMs } = store.get(file);
        return { kind: "file", size: text.length, mtimeMs };
      },
      list: async (dir) => {
        const names = [...store.keys()]
          .filter((file) => file.startsWith(`${dir}/`))
          .map((file) => file.slice(dir.length + 1));
        if (!names.length) throw missing(dir);
        return names.map((name) => ({ name, kind: "file" }));
      },
    },
    session: {
      agentTranscriptPath: async () => session.agentTranscriptPath ?? "",
    },
  };
}

test("save and load round-trip a ledger with one write", async () => {
  const io = memoryIo();
  const empty = await load(io, "s1", "a1");
  expect(empty.seq).toBe(0);
  expect(empty.prompts).toStrictEqual([]);
  await save(io, "s1", "a1", { ...empty, seq: 3 });
  expect([...io.store.keys()]).toStrictEqual([`${DIR}/s1.a1.json`]);
  expect((await load(io, "s1", "a1")).seq).toBe(3);
  expect((await load(io, "s1", null)).seq).toBe(0);
});

test("editedBySession joins the session and its subagents only", async () => {
  const io = memoryIo({
    [`${DIR}/s1.json`]: JSON.stringify({ edited: ["a.js"] }),
    [`${DIR}/s1.a1.json`]: JSON.stringify({ edited: ["b.js", "a.js"] }),
    [`${DIR}/s1.a2.json`]: "{ half a fi",
    [`${DIR}/s10.json`]: JSON.stringify({ edited: ["other.js"] }),
  });
  expect([...(await editedBySession(io, "s1"))].sort()).toStrictEqual([
    "a.js",
    "b.js",
  ]);
  expect((await editedBySession(memoryIo(), "s1")).size).toBe(0);
});

test("readStamp and recordRead use io.fs.stat", async () => {
  const io = memoryIo({ "/work/a.js": "abc" });
  expect(await readStamp(io, "/work/a.js")).toStrictEqual({
    size: 3,
    mtimeMs: 1000,
  });
  expect(await readStamp(io, "/work/none.js")).toBe(null);
  const state = {};
  await recordRead(io, state, "/work/a.js", "Read");
  await recordRead(io, state, "/work/none.js", "Read");
  expect(state.reads).toStrictEqual({
    "/work/a.js": { size: 3, mtimeMs: 1000, how: "Read" },
  });
});

test("fullReads expands ~ with the given home", () => {
  expect(fullReads("cat ~/a.txt b.txt", "/work", "/home/u", "posix")).toEqual([
    "/home/u/a.txt",
    "/work/b.txt",
  ]);
});

test("agentStarted writes the transcript path from io.session", async () => {
  const io = memoryIo(
    { "/t/agent-a1.jsonl": "" },
    { agentTranscriptPath: "/t/agent-a1.jsonl" },
  );
  await agentStarted(io, "s1", "a1");
  expect(await io.fs.read(`${DIR}/s1.a1.running`)).toBe("/t/agent-a1.jsonl");
  expect(await runningAgents(io, "s1", 60_000, 1000 + 59_999)).toBe(1);
  expect(await runningAgents(io, "s1", 60_000, 1000 + 60_000)).toBe(0);
  expect(await runningAgents(io, "s2", 60_000, 1000)).toBe(0);
});

test("runningAgents with no state folder counts 0", async () => {
  expect(await runningAgents(memoryIo(), "s1", 60_000)).toBe(0);
});

test("agentStopped removes the marker", async () => {
  const removed = [];
  const io = memoryIo();
  io.fs.remove = async (file) => {
    removed.push(file);
  };
  await agentStopped(io, "s1", "a/1");
  expect(removed).toStrictEqual([`${DIR}/s1.a_1.running`]);
});
