// The loop and nested-instruction helpers run on the io seam: a fake io with
// files in memory gives the same results on posix and win32 paths.

import { expect, test } from "bun:test";
import {
  loopProgress,
  loopSlices,
  mainRoot,
  oracleFor,
  protectedGlobs,
  protectedMatch,
} from "../../hooks/lib/_loop.mjs";
import {
  contextFor,
  instructionFiles,
  readPaths,
} from "../../hooks/lib/_nested-instructions.mjs";

/** An io over `files`, a map of path to text. A folder exists by prefix. */
function fakeIo(files, { platform = "posix", cwd = "/p" } = {}) {
  const sep = platform === "win32" ? "\\" : "/";
  const has = (p) => p in files;
  const isDir = (p) => Object.keys(files).some((f) => f.startsWith(p + sep));
  return {
    platform,
    cwd,
    fs: {
      read: async (p) => {
        if (!has(p)) throw new Error("missing");
        return files[p];
      },
      exists: async (p) => has(p) || isDir(p),
      stat: async (p) => {
        if (has(p)) return { kind: "file" };
        if (isDir(p)) return { kind: "dir" };
        throw new Error("missing");
      },
    },
  };
}

const LOOP = JSON.stringify({ protected: ["tests/**", " ", 3] });

test("loop files are read from the main root on posix and win32", async () => {
  const posix = fakeIo({
    "/p/.dotclaude/loop/loop.json": LOOP,
    "/p/.dotclaude/loop/slices.jsonl":
      '{"id":"a","status":"merged"}\nnot json\n{"id":"b","status":"pending"}\n',
  });
  expect(await mainRoot(posix, "/p/.claude/worktrees/w1/src")).toBe("/p");
  expect(await protectedGlobs(posix, "/p/.claude/worktrees/w1")).toEqual([
    "tests/**",
  ]);
  expect(await loopSlices(posix, "/p")).toHaveLength(2);
  expect(await loopProgress(posix, "/p/.claude/worktrees/w1")).toEqual({
    done: 1,
    total: 2,
  });

  const win = fakeIo(
    { "C:\\p\\.dotclaude\\loop\\loop.json": LOOP },
    { platform: "win32", cwd: "C:\\p" },
  );
  expect(await mainRoot(win, "C:\\p\\.claude\\worktrees\\w1")).toBe("C:\\p");
  expect(await protectedGlobs(win, "C:\\p\\.claude\\worktrees\\w1")).toEqual([
    "tests/**",
  ]);
  expect(await loopProgress(win, "C:\\p")).toBeNull();
});

test("a relative root resolves against the io folder", async () => {
  const io = fakeIo({ "/p/.dotclaude/loop/loop.json": LOOP });
  expect(await mainRoot(io, "src")).toBe("/p/src");
  expect(await protectedGlobs(io, ".")).toEqual(["tests/**"]);
});

test("the oracle is set for a subagent with protected globs only", async () => {
  const io = fakeIo({ "/p/.dotclaude/loop/loop.json": LOOP });
  expect(await oracleFor(io, {}, "/p")).toBeUndefined();
  expect(await oracleFor(io, { agent_id: "a1" }, "/p")).toEqual({
    root: "/p",
    globs: ["tests/**"],
    platform: io.platform,
  });
  expect(await oracleFor(io, { agent_id: "a1" }, "/q")).toBeUndefined();
});

test("protectedMatch is pure and maps a worktree path to the root", () => {
  const globs = ["tests/**", "*.lock", "src/{a,b}.mjs"];
  expect(protectedMatch("/p/tests/a/b.mjs", "/p", globs, "posix")).toBe(
    "tests/**",
  );
  expect(
    protectedMatch("/p/.claude/worktrees/w1/tests/a.mjs", "/p", globs, "posix"),
  ).toBe("tests/**");
  expect(protectedMatch("/p/x.lock", "/p", globs, "posix")).toBe("*.lock");
  expect(protectedMatch("/p/src/b.mjs", "/p", globs, "posix")).toBe(
    "src/{a,b}.mjs",
  );
  expect(protectedMatch("/p/src/c.mjs", "/p", globs, "posix")).toBeNull();
  expect(protectedMatch("/other/tests/a.mjs", "/p", globs, "posix")).toBeNull();
  expect(protectedMatch("/p/tests/a.mjs", "/p", [], "posix")).toBeNull();
  expect(protectedMatch("C:\\p\\tests\\a.mjs", "C:\\p", globs, "win32")).toBe(
    "tests/**",
  );
});

test("nested instruction files are found through the io", async () => {
  const io = fakeIo({
    "/r/CLAUDE.md": "root",
    "/r/pkg/CLAUDE.md": "pkg",
    "/r/pkg/.claude/CLAUDE.md": "pkg dot",
    "/r/pkg/api/server.ts": "",
  });
  expect(
    await readPaths(io, "cat pkg/api/server.ts /etc/x", "/r", "/r"),
  ).toEqual(["/r/pkg/api/server.ts"]);
  const files = await instructionFiles(io, "/r/pkg/api/server.ts", "/r");
  expect(files).toEqual(["/r/pkg/CLAUDE.md", "/r/pkg/.claude/CLAUDE.md"]);
  expect(await instructionFiles(io, "/r/missing.txt", "/r")).toEqual([]);
  const text = await contextFor(io, [...files, "/r/gone.md"], "/r");
  expect(text).toContain("Contents of `pkg/CLAUDE.md`");
  expect(text).toContain("pkg dot");
  expect(await contextFor(io, ["/r/gone.md"], "/r")).toBeNull();
});
