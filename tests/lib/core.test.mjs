// The pure helpers of `_core.mjs` read the host only through the `io` or
// `env` object that the caller gives.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  option,
  optionList,
  preToolOutput,
  projectRoot,
  pruneState,
  stateDir,
  TAG,
  tagOutput,
  verdict,
} from "../../hooks/lib/_core.mjs";

const io = (fields = {}) => ({
  platform: "posix",
  env: {},
  home: "/home/u",
  tmp: "/tmp",
  cwd: "/work",
  ...fields,
});

test("option reads CLAUDE_PLUGIN_OPTION_<KEY> from the given env", () => {
  expect(option({}, "guard_bash")).toBe(true);
  expect(option({}, "guard_bash", false)).toBe(false);
  for (const off of ["0", "false", "No", " off ", ""])
    expect(option({ CLAUDE_PLUGIN_OPTION_GUARD_BASH: off }, "guard_bash")).toBe(
      false,
    );
  expect(
    option({ CLAUDE_PLUGIN_OPTION_GUARD_BASH: "1" }, "guard_bash", false),
  ).toBe(true);
});

test("optionList splits JSON or commas, with the fallback for an empty value", () => {
  const key = "CLAUDE_PLUGIN_OPTION_MODEL_ALLOWED";
  expect(optionList({}, "model_allowed", "a, b")).toStrictEqual(["a", "b"]);
  expect(optionList({ [key]: "  " }, "model_allowed", "a")).toStrictEqual([
    "a",
  ]);
  expect(
    optionList({ [key]: '[" x ", "", 2]' }, "model_allowed", "a"),
  ).toStrictEqual(["x", "2"]);
  expect(optionList({ [key]: "[x, y" }, "model_allowed", "a")).toStrictEqual([
    "[x",
    "y",
  ]);
});

test("stateDir is under CLAUDE_PLUGIN_DATA or the temp folder", () => {
  expect(stateDir(io())).toBe("/tmp/dotclaude/sessions");
  expect(stateDir(io({ env: { CLAUDE_PLUGIN_DATA: "/data" } }))).toBe(
    "/data/sessions",
  );
  expect(stateDir(io({ platform: "win32", tmp: "C:\\Temp" }))).toBe(
    "C:\\Temp\\dotclaude\\sessions",
  );
});

test("pruneState removes only old files, through io.fs", async () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;
  const files = {
    "/tmp/dotclaude/sessions/old.json": {
      kind: "file",
      mtimeMs: now - 31 * day,
    },
    "/tmp/dotclaude/sessions/new.json": {
      kind: "file",
      mtimeMs: now - 29 * day,
    },
    "/tmp/dotclaude/sessions/edge.json": {
      kind: "file",
      mtimeMs: now - 30 * day,
    },
    "/tmp/dotclaude/sessions/gone.json": null,
    "/tmp/dotclaude/sessions/sub": { kind: "dir", mtimeMs: 0 },
  };
  const removed = [];
  const fsIo = {
    list: async () =>
      Object.keys(files).map((file) => ({ name: path.posix.basename(file) })),
    stat: async (file) => {
      // Another session removed this file after the list.
      if (files[file] === null) throw new Error("ENOENT");
      return files[file];
    },
    remove: async (file) => {
      removed.push(file);
    },
  };
  expect(await pruneState(io({ fs: fsIo }), now)).toBe(1);
  expect(removed).toStrictEqual(["/tmp/dotclaude/sessions/old.json"]);
});

test("pruneState with no state folder removes nothing", async () => {
  const fsIo = {
    list: async () => {
      throw new Error("ENOENT");
    },
  };
  expect(await pruneState(io({ fs: fsIo }))).toBe(0);
});

test("projectRoot prefers CLAUDE_PROJECT_DIR, then data.cwd, then io.cwd", () => {
  expect(projectRoot(io({ env: { CLAUDE_PROJECT_DIR: "p" } }), {})).toBe(
    "/work/p",
  );
  expect(projectRoot(io(), { cwd: "/repo/./sub/.." })).toBe("/repo");
  expect(projectRoot(io(), {})).toBe("/work");
  const win = io({ platform: "win32", cwd: "C:\\work" });
  expect(projectRoot(win, { cwd: "D:\\x\\..\\y" })).toBe("D:\\y");
  expect(projectRoot(win, { cwd: "rel" })).toBe("C:\\work\\rel");
});

test("preToolOutput builds the PreToolUse decision", () => {
  expect(preToolOutput("ask", "why")).toStrictEqual({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "why",
    },
  });
});

test("tagOutput tags text for Claude and leaves the input unchanged", () => {
  const input = {
    systemMessage: "note",
    reason: `${TAG} once`,
    hookSpecificOutput: {
      additionalContext: "ctx",
      permissionDecision: "ask",
      permissionDecisionReason: "user sees this",
    },
  };
  const out = tagOutput(input);
  expect(out.systemMessage).toBe(`${TAG} note`);
  expect(out.reason).toBe(`${TAG} once`);
  expect(out.hookSpecificOutput.additionalContext).toBe(`${TAG} ctx`);
  expect(out.hookSpecificOutput.permissionDecisionReason).toBe(
    "user sees this",
  );
  expect(input.systemMessage).toBe("note");
  expect(
    tagOutput(preToolOutput("deny", "no")).hookSpecificOutput
      .permissionDecisionReason,
  ).toBe(`${TAG} no`);
});

test("verdict: deny wins, and warn is quiet in auto unless the env option is on", () => {
  const findings = [
    ["warn", "risky"],
    ["ask", "check this"],
  ];
  expect(verdict([["deny", "bad"], ...findings], {}, "edit", {})).toStrictEqual(
    ["deny", "blocked this edit. Bad."],
  );
  expect(verdict([["deny", "bad"]], {}, "command", {})[1]).toContain(
    "`! <command>`",
  );
  expect(verdict(findings, {}, "edit", {})).toStrictEqual([
    "ask",
    "Risky. Check this.",
  ]);
  const auto = { permission_mode: "auto" };
  expect(verdict([["warn", "risky"]], auto, "edit", {})).toBeNull();
  expect(
    verdict([["warn", "risky"]], auto, "edit", {
      CLAUDE_PLUGIN_OPTION_GUARD_ASK_IN_AUTO: "true",
    }),
  ).toStrictEqual(["ask", "Risky."]);
});

test("_core.mjs reaches no host API directly", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "../../hooks/lib/_core.mjs"),
    "utf8",
  );
  expect(source).not.toMatch(/["']node:/);
  expect(source).not.toContain("process.");
  expect(source).not.toContain("Bun.");
  expect(source).not.toContain("globalThis");
  expect(
    [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
  ).toStrictEqual(["./_path.mjs"]);
});
