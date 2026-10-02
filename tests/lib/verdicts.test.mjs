// The verdict log and the ask memory reach the host only through `io.fs`.
// The memory fs below has no `remove` and no rename, as the engine io.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  approveAsk,
  guardDecision,
  logVerdict,
} from "../../hooks/lib/_verdicts.mjs";

const LOG = "/data/verdicts.jsonl";
const OLD_LOG = "/data/verdicts.1.jsonl";

function memoryIo(files = {}) {
  const store = new Map(Object.entries(files));
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
        return store.get(file);
      },
      write: async (file, text) => {
        store.set(file, text);
      },
      append: async (file, text) => {
        store.set(file, (store.get(file) ?? "") + text);
      },
      exists: async (file) => store.has(file),
      stat: async (file) => {
        if (!store.has(file)) throw missing(file);
        return { kind: "file", size: store.get(file).length, mtimeMs: 0 };
      },
      list: async () => [],
    },
  };
}

const data = {
  session_id: "s1",
  tool_name: "Bash",
  tool_use_id: "t1",
  tool_input: { command: "git push --force" },
  permission_mode: "default",
};

test("logVerdict appends one JSON line per verdict", async () => {
  const io = memoryIo();
  await logVerdict(io, data, "deny", "a reason");
  await logVerdict(io, data, "ask", "b reason", { rule: "x" });
  const lines = io.store.get(LOG).trimEnd().split("\n").map(JSON.parse);
  expect(lines.map((l) => [l.level, l.reason, l.target, l.rule])).toStrictEqual(
    [
      ["deny", "a reason", "git push --force", undefined],
      ["ask", "b reason", "git push --force", "x"],
    ],
  );
});

test("logVerdict rotates a full log with writes only", async () => {
  const full = `${"x".repeat(1_000_001)}\n`;
  const io = memoryIo({ [LOG]: full, [OLD_LOG]: "older\n" });
  await logVerdict(io, data, "deny", "after rotation");
  expect(io.store.get(OLD_LOG)).toBe(full);
  const lines = io.store.get(LOG).trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).reason).toBe("after rotation");
});

test("logVerdict keeps a log at the size limit", async () => {
  const atLimit = "x".repeat(1_000_000);
  const io = memoryIo({ [LOG]: atLimit });
  await logVerdict(io, data, "deny", "r");
  expect(io.store.has(OLD_LOG)).toBe(false);
  expect(io.store.get(LOG).startsWith(atLimit)).toBe(true);
});

test("guardDecision returns the output, and an approved ask is not asked again", async () => {
  const io = memoryIo();
  const findings = [["ask", "it rewrites history"]];
  const first = await guardDecision(io, findings, data, "command");
  expect(first.hookSpecificOutput.permissionDecision).toBe("ask");
  expect(first.hookSpecificOutput.permissionDecisionReason).toBe(
    "It rewrites history.",
  );
  await approveAsk(io, { ...data, hook_event_name: "PostToolUse" });
  const again = await guardDecision(
    io,
    findings,
    { ...data, tool_use_id: "t2" },
    "command",
  );
  expect(again).toBe(null);
  const levels = io.store
    .get(LOG)
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l).level);
  expect(levels).toStrictEqual(["ask", "remembered"]);
});

test("guardDecision returns null for no findings and never remembers a deny", async () => {
  const io = memoryIo();
  expect(await guardDecision(io, [], data, "command")).toBe(null);
  const deny = [["deny", "it deletes home"]];
  await guardDecision(io, deny, data, "command");
  await approveAsk(io, { ...data, hook_event_name: "PostToolUse" });
  const again = await guardDecision(io, deny, data, "command");
  expect(again.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("guardDecision reads the guard_ask_in_auto option from io.env", async () => {
  const auto = { ...data, permission_mode: "auto" };
  const warn = [["warn", "it deletes a file"]];
  expect(await guardDecision(memoryIo(), warn, auto, "command")).toBe(null);
  const io = memoryIo();
  io.env.CLAUDE_PLUGIN_OPTION_GUARD_ASK_IN_AUTO = "true";
  const out = await guardDecision(io, warn, auto, "command");
  expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
});

test("_verdicts.mjs reaches no host API directly", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "../../hooks/lib/_verdicts.mjs"),
    "utf8",
  );
  expect(source).not.toMatch(/["']node:/);
  expect(source).not.toContain("process.");
  expect(source).not.toContain("Bun.");
  expect(
    [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
  ).toStrictEqual(["./_core.mjs", "./_path.mjs"]);
});
