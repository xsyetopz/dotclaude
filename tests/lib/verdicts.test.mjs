// The verdict log and the ask memory reach the host only through `io.fs`.
// The memory fs below has no `remove` and no rename, and it reads at most
// 4 MiB and gives sizes in bytes, as the engine io.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  approveAsk,
  clearKindApprovals,
  guardDecision,
  logVerdict,
} from "../../hooks/lib/_verdicts.mjs";
import clearAskApprovals from "../../hooks/user-prompt-submit/clear-ask-approvals.mjs";

const LOG = "/data/verdicts.jsonl";
const OLD_LOG = "/data/verdicts.1.jsonl";

const READ_MAX = 4 * 1024 * 1024;
const bytes = (text) => new TextEncoder().encode(text).length;

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
        if (bytes(store.get(file)) > READ_MAX)
          throw new Error(`${file}: larger than 4 MiB`);
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
        return { kind: "file", size: bytes(store.get(file)), mtimeMs: 0 };
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

test("logVerdict does not rotate again after another caller rotated the log", async () => {
  // The stat is from before the other caller emptied the main file.
  const full = `${"x".repeat(1_000_001)}\n`;
  const io = memoryIo({ [LOG]: "", [OLD_LOG]: full });
  io.fs.stat = async () => ({ kind: "file", size: bytes(full), mtimeMs: 0 });
  await logVerdict(io, data, "deny", "late caller");
  expect(io.store.get(OLD_LOG)).toBe(full);
  expect(JSON.parse(io.store.get(LOG)).reason).toBe("late caller");
});

test("logVerdict rotates a log by its size in bytes", async () => {
  const full = "é".repeat(600_000);
  const io = memoryIo({ [LOG]: full });
  await logVerdict(io, data, "deny", "r");
  expect(io.store.get(OLD_LOG)).toBe(full);
  expect(io.store.get(LOG).trimEnd().split("\n")).toHaveLength(1);
});

test("logVerdict starts a log that is too large to read again", async () => {
  const huge = "x".repeat(READ_MAX + 1);
  const io = memoryIo({ [LOG]: huge, [OLD_LOG]: "older\n" });
  await logVerdict(io, data, "deny", "after the cap");
  expect(io.store.get(OLD_LOG)).toBe("older\n");
  expect(JSON.parse(io.store.get(LOG)).reason).toBe("after the cap");
});

test("logVerdict resolves when the log cannot be written", async () => {
  const io = memoryIo();
  io.fs.append = async () => {
    throw new Error("disk full");
  };
  await logVerdict(io, data, "deny", "r");
  expect(io.store.has(LOG)).toBe(false);
});

test("guardDecision gives the decision when the log and the memory cannot be written", async () => {
  const io = memoryIo();
  const fail = async () => {
    throw new Error("disk full");
  };
  io.fs.write = fail;
  io.fs.append = fail;
  const deny = await guardDecision(
    io,
    [["deny", "it deletes home"]],
    data,
    "command",
  );
  expect(deny.hookSpecificOutput.permissionDecision).toBe("deny");
  const ask = await guardDecision(
    io,
    [["ask", "it rewrites history"]],
    data,
    "command",
  );
  expect(ask.hookSpecificOutput.permissionDecision).toBe("ask");
});

test("guardDecision keeps the ask memory small for a large Write", async () => {
  const io = memoryIo();
  const write = {
    ...data,
    tool_name: "Write",
    tool_input: { file_path: "/work/a.js", content: "x".repeat(1_000_000) },
  };
  const ask = [["ask", "it overwrites a file"]];
  expect(await guardDecision(io, ask, write, "edit")).not.toBe(null);
  expect(bytes(io.store.get("/data/sessions/asks-s1.json"))).toBeLessThan(500);
  await approveAsk(io, { ...write, hook_event_name: "PostToolUse" });
  const again = { ...write, tool_use_id: "t2" };
  expect(await guardDecision(io, ask, again, "edit")).toBe(null);
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
  ).toStrictEqual(["./_core.mjs", "./_path.mjs", "./_sha1.mjs"]);
});

const editAsk = (n) => ({
  ...data,
  session_id: "s1",
  tool_name: "Edit",
  tool_use_id: `e${n}`,
  tool_input: { file_path: `/work/tests/f${n}.test.js`, new_string: `${n}` },
});
const removal = [["ask", "the edit removes 1 assertion(s)", "test-edit"]];
const post = (d) => ({ ...d, hook_event_name: "PostToolUse" });
const text = (out) => out.hookSpecificOutput.permissionDecisionReason;

test("an approved test ask lets the other test asks of its kind pass", async () => {
  const io = memoryIo();
  const first = await guardDecision(io, removal, editAsk(1), "edit");
  expect(text(first)).toContain(
    "If the user approves this edit, the other test edits of this kind also pass until the user sends the next message.",
  );
  await approveAsk(io, post(editAsk(1)));
  expect(await guardDecision(io, removal, editAsk(2), "edit")).toBe(null);
  const other = [["ask", "the edit changes TLS", "tls"]];
  expect(await guardDecision(io, other, editAsk(3), "edit")).not.toBe(null);
  const mixed = [...removal, ["ask", "it also edits a generated file"]];
  const out = await guardDecision(io, mixed, editAsk(4), "edit");
  expect(text(out)).not.toContain("this kind");
  const deletion = [["ask", "`rm` deletes a test file", "test-delete"]];
  expect(await guardDecision(io, deletion, data, "command")).not.toBe(null);
});

test("a denied test ask records nothing", async () => {
  const io = memoryIo();
  await guardDecision(io, removal, editAsk(1), "edit");
  // No PostToolUse: the user denied the ask, so the tool did not run.
  expect(await guardDecision(io, removal, editAsk(2), "edit")).not.toBe(null);
});

test("the next prompt of the user clears the approved kind", async () => {
  const io = memoryIo();
  await guardDecision(io, removal, editAsk(1), "edit");
  await approveAsk(io, post(editAsk(1)));
  await clearAskApprovals(io, {
    session_id: "s1",
    prompt: "<task-notification>x</task-notification>",
  });
  expect(await guardDecision(io, removal, editAsk(2), "edit")).toBe(null);
  await clearAskApprovals(io, { session_id: "s1", prompt: "go on" });
  expect(await guardDecision(io, removal, editAsk(3), "edit")).not.toBe(null);
  await clearKindApprovals(io, { session_id: "other" });
});
