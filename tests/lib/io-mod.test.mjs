// The hooks-module io over a small fake of the engine's `$`, with the shapes
// of the engine types (`FsStat`, `FsEntry`, `ProcessRunResult`,
// `SessionMessage`, `SessionUsage`).

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { modIo, platformOf } from "../../hooks/lib/_io-mod.mjs";

const enc = new TextEncoder();
const toBase64 = (text) => Buffer.from(enc.encode(text)).toString("base64");

const enoent = (file) =>
  Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });

/** A fake `$`. Files are a map from path to text, and folders are implicit. */
function fake(init = {}) {
  const files = new Map(Object.entries(init.files ?? {}));
  const env = init.env ?? {};
  const runs = [];
  const $ = {
    plugin: { name: "dotclaude", root: init.root ?? "/plugins/dotclaude" },
    env: { get: async (name) => env[name] },
    fs: {
      read: async (file, options) => {
        if (!files.has(file)) throw enoent(file);
        const text = files.get(file);
        if (enc.encode(text).length > 4 * 1024 * 1024)
          throw new Error(`${file}: over 4 MiB`);
        return options?.as === "bytes" ? { base64: toBase64(text) } : text;
      },
      write: async (file, text) => {
        files.set(file, text);
      },
      exists: async (file) => files.has(file),
      stat: async (file, options) => {
        if (!files.has(file)) throw enoent(file);
        const out = {
          kind: "file",
          size: enc.encode(files.get(file)).length,
          mtimeMs: 5,
          isLink: false,
        };
        if (options?.resolve) out.realPath = `/real${file}`;
        return out;
      },
      list: async () => [
        { name: "a.json", kind: "file", size: 3, mtimeMs: 7, isLink: false },
        { name: "sub", kind: "dir", size: 0, mtimeMs: 0, isLink: false },
        { name: "ln", kind: "other", size: 0, mtimeMs: 0, isLink: true },
      ],
    },
    process: {
      run: async (argv, request) => {
        runs.push({ argv, request });
        if (argv[0] === "missing") throw new Error("spawn missing ENOENT");
        return {
          exitCode: 3,
          stdout: init.stdout ?? "out",
          stderr: "err",
          isStdoutTruncated: init.truncated ?? false,
          isStderrTruncated: false,
        };
      },
    },
    session: {
      cwd: async () => "/work",
      messages: async (args) => {
        if (args?.agentId === undefined) {
          if (init.mainRows instanceof Error) throw init.mainRows;
          return init.mainRows ?? [];
        }
        return init.agentRows ?? { deny: `no agent ${args.agentId}` };
      },
      usage: async () =>
        init.usage ?? {
          startedAt: 0,
          context: { window: 200000 },
          rateLimits: [],
        },
    },
  };
  return { $, files, runs };
}

const row = (role, text, extra = {}) => ({
  role,
  text,
  toolUses: [],
  ...extra,
});
const result = row("user", "", {
  toolResults: [{ tool_use_id: "t1", text: "ok", isError: false }],
});

test("platform comes from the shape of the plugin root", async () => {
  expect(platformOf("/Users/me/.claude/plugins/dotclaude")).toBe("posix");
  expect(platformOf("C:\\Users\\me\\plugins")).toBe("win32");
  expect(platformOf("\\\\server\\share\\plugins")).toBe("win32");
  const { $ } = fake({
    root: "C:\\p",
    env: { USERPROFILE: "C:\\Users\\me", TEMP: "C:\\T\\" },
  });
  const io = await modIo($);
  expect(io).toMatchObject({
    platform: "win32",
    home: "C:\\Users\\me",
    tmp: "C:\\T",
    pluginRoot: "C:\\p",
  });
});

test("home, tmp, cwd, and pluginRoot come from the engine", async () => {
  const { $ } = fake({ env: { HOME: "/home/me", TMPDIR: "/var/tmp/" } });
  const io = await modIo($);
  expect(io).toMatchObject({
    platform: "posix",
    home: "/home/me",
    tmp: "/var/tmp",
    cwd: "/work",
    pluginRoot: "/plugins/dotclaude",
  });
  expect((await modIo(fake().$)).tmp).toBe("/tmp");
});

test("env holds the listed names and the plugin options", async () => {
  const { $ } = fake({
    env: { HOME: "/h", CLAUDE_PROJECT_DIR: "/p", NOT_LISTED: "x" },
  });
  const io = await modIo($, {
    guard_bash: false,
    usage_scratchpad_prune_days: 7,
    model_allowed: "opus,sonnet",
    model_list: ["a", "b"],
  });
  expect(io.env).toEqual({
    HOME: "/h",
    CLAUDE_PROJECT_DIR: "/p",
    CLAUDE_PLUGIN_OPTION_GUARD_BASH: "false",
    CLAUDE_PLUGIN_OPTION_USAGE_SCRATCHPAD_PRUNE_DAYS: "7",
    CLAUDE_PLUGIN_OPTION_MODEL_ALLOWED: "opus,sonnet",
    CLAUDE_PLUGIN_OPTION_MODEL_LIST: '["a","b"]',
  });
});

test("env reads every name that the closure reads", async () => {
  const names = new Set();
  const env = new Proxy(
    {},
    {
      get: (_, name) => {
        names.add(name);
        return undefined;
      },
    },
  );
  await modIo(fake({ env }).$);
  for (const name of [
    "CLAUDE_PLUGIN_DATA",
    "CLAUDE_PROJECT_DIR",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_TMPDIR",
    "CLAUDE_CODE_FORK_SUBAGENT",
    "CLAUDE_CODE_EFFORT_LEVEL",
    "CLAUDE_CODE_DISABLE_FAST_MODE",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "TMPDIR",
    "HOME",
    "GH_CONFIG_DIR",
    "XDG_CONFIG_HOME",
    "AppData",
  ])
    expect(names).toContain(name);
});

test("read, write, exists, stat, and list map to $.fs", async () => {
  const { $, files } = fake({ files: { "/a": "hi" } });
  const io = await modIo($);
  expect(await io.fs.read("/a")).toBe("hi");
  await expect(io.fs.read("/none")).rejects.toThrow("ENOENT");
  await io.fs.write("/d/new/b", "x");
  expect(files.get("/d/new/b")).toBe("x");
  expect(await io.fs.exists("/a")).toBe(true);
  expect(await io.fs.exists("/none")).toBe(false);
  expect(await io.fs.stat("/a")).toEqual({
    kind: "file",
    size: 2,
    mtimeMs: 5,
    isLink: false,
  });
  expect((await io.fs.stat("/a", { resolve: true })).realPath).toBe("/real/a");
  await expect(io.fs.stat("/none")).rejects.toThrow("ENOENT");
  expect(await io.fs.list("/d")).toEqual([
    { name: "a.json", kind: "file", size: 3, mtimeMs: 7, isLink: false },
    { name: "sub", kind: "dir", size: 0, mtimeMs: 0, isLink: false },
    { name: "ln", kind: "other", size: 0, mtimeMs: 0, isLink: true },
  ]);
});

test("head gives the first bytes, not characters", async () => {
  const { $ } = fake({ files: { "/a": "é-abc" } });
  const io = await modIo($);
  expect(await io.fs.head("/a", 3)).toEqual(new Uint8Array([0xc3, 0xa9, 45]));
  expect(await io.fs.head("/a", 100)).toEqual(enc.encode("é-abc"));
  await expect(io.fs.head("/none", 3)).rejects.toThrow("ENOENT");
});

test("head and read reject a file over 4 MiB", async () => {
  const big = "x".repeat(4 * 1024 * 1024 + 1);
  const io = await modIo(fake({ files: { "/big": big } }).$);
  await expect(io.fs.head("/big", 10)).rejects.toThrow("4 MiB");
  await expect(io.fs.read("/big")).rejects.toThrow("4 MiB");
});

test("append adds to the end and creates a missing file", async () => {
  const { $, files } = fake({ files: { "/log": "a\n" } });
  const io = await modIo($);
  await io.fs.append("/log", "b\n");
  await io.fs.append("/new/log", "c\n");
  expect(files.get("/log")).toBe("a\nb\n");
  expect(files.get("/new/log")).toBe("c\n");
});

test("append rejects and keeps the file when it cannot read it", async () => {
  const big = "x".repeat(4 * 1024 * 1024 + 1);
  const { $, files } = fake({ files: { "/big": big } });
  const io = await modIo($);
  await expect(io.fs.append("/big", "y")).rejects.toThrow("4 MiB");
  expect(files.get("/big")).toBe(big);
});

test("create writes only a new file", async () => {
  const { $, files } = fake({ files: { "/a": "old" } });
  const io = await modIo($);
  expect(await io.fs.create("/a", "new")).toBe(false);
  expect(files.get("/a")).toBe("old");
  expect(await io.fs.create("/b", "new")).toBe(true);
  expect(files.get("/b")).toBe("new");
});

test("remove empties a file and does not make a missing one", async () => {
  const { $, files } = fake({ files: { "/a": "data" } });
  const io = await modIo($);
  await io.fs.remove("/a");
  await io.fs.remove("/none");
  expect(files.get("/a")).toBe("");
  expect(files.has("/none")).toBe(false);
});

test("run passes cwd, stdin, env, and timeoutMs, and keeps the exit code", async () => {
  const { $, runs } = fake();
  const io = await modIo($);
  const out = await io.run(["tool", "-x"], {
    cwd: "/c",
    stdin: "in",
    env: { A: "1" },
    timeoutMs: 500,
  });
  expect(out).toEqual({ exitCode: 3, stdout: "out", stderr: "err" });
  expect(runs[0]).toEqual({
    argv: ["tool", "-x"],
    request: { cwd: "/c", stdin: "in", env: { A: "1" }, timeoutMs: 500 },
  });
  await io.run(["tool"]);
  expect(runs[1].request).toEqual({ timeoutMs: 30_000 });
});

test("run rejects when the command cannot start", async () => {
  const io = await modIo(fake().$);
  await expect(io.run(["missing"])).rejects.toThrow("ENOENT");
});

test("run rejects past maxBytes and on an engine cut", async () => {
  const io = await modIo(fake({ stdout: "x".repeat(8) }).$);
  expect((await io.run(["t"], { maxBytes: 11 })).stdout).toBe("xxxxxxxx");
  await expect(io.run(["t"], { maxBytes: 10 })).rejects.toThrow(
    "output passed 10 bytes",
  );
  const cut = await modIo(fake({ truncated: true }).$);
  await expect(cut.run(["t"])).rejects.toThrow("output passed");
});

test("lastPrompt is the last typed user row, cut at 4000 characters", async () => {
  const long = "y".repeat(4001);
  const rows = [
    row("user", "first"),
    row("assistant", "a"),
    row("user", long),
    row("assistant", "b"),
    result,
    row("user", "<system-reminder>x</system-reminder>"),
    row("user", "Caveat: local command"),
  ];
  const io = await modIo(fake({ mainRows: rows }).$);
  expect(await io.session.lastPrompt()).toBe(`${"y".repeat(4000)} [...]`);
  const short = await modIo(fake({ mainRows: rows.slice(0, 2) }).$);
  expect(await short.session.lastPrompt()).toBe("first");
});

test("lastPrompt is empty when not known", async () => {
  expect(await (await modIo(fake().$)).session.lastPrompt()).toBe("");
  const io = await modIo(fake({ mainRows: new Error("refused") }).$);
  expect(await io.session.lastPrompt()).toBe("");
});

test("agentTurns counts assistant rows since the last prompt", async () => {
  const agentRows = [
    row("user", "task"),
    row("assistant", "1"),
    row("user", "resume"),
    row("assistant", "2"),
    result,
    row("assistant", "3"),
    result,
  ];
  const io = await modIo(fake({ agentRows }).$, {}, { agent_id: "a1" });
  expect(await io.session.agentTurns()).toBe(2);
});

test("agentTurns is null on a refusal or with no agent", async () => {
  const denied = await modIo(fake().$, {}, { agent_id: "a1" });
  expect(await denied.session.agentTurns()).toBeNull();
  const main = await modIo(fake({ agentRows: [row("assistant", "x")] }).$);
  expect(await main.session.agentTurns()).toBeNull();
});

test("mainContextTokens comes from usage().context.tokens", async () => {
  const usage = {
    startedAt: 0,
    context: { tokens: 1234, window: 200000, percent: 1 },
    rateLimits: [],
  };
  expect(
    await (await modIo(fake({ usage }).$)).session.mainContextTokens(),
  ).toBe(1234);
  expect(await (await modIo(fake().$)).session.mainContextTokens()).toBeNull();
});

test("agentStoppedAtLimit reads the task notifications in the rows", async () => {
  const note =
    "<task-notification><task-id>a1</task-id><summary>Agent stopped at its 40-turn limit</summary></task-notification>";
  const io = await modIo(
    fake({ mainRows: [row("user", note), row("assistant", "ok")] }).$,
  );
  expect(await io.session.agentStoppedAtLimit("a1")).toBe(true);
  expect(await io.session.agentStoppedAtLimit("a2")).toBe(false);
  const refused = await modIo(fake({ mainRows: new Error("refused") }).$);
  expect(await refused.session.agentStoppedAtLimit("a1")).toBeNull();
});

test("facts that the engine cannot give resolve their unknown value", async () => {
  const { session } = await modIo(fake().$, {}, { agent_id: "a1" });
  expect(await session.agentTranscriptPath()).toBe("");
  expect(await session.agentContext()).toBeNull();
  expect(await session.loadedNested()).toBeNull();
  expect(await session.compactions()).toBeNull();
});

test("_io-mod.mjs uses no Node, Bun, process, or dynamic import", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dir, "../../hooks/lib/_io-mod.mjs"),
    "utf8",
  );
  for (const banned of ["node:", "Bun.", "process.", "import("]) {
    const at = source.split("\n").findIndex((line) => {
      // The engine's own `$.process` is not the Node global.
      const code = line.replace(/\/\/.*$/, "").replaceAll("$.process.", "");
      return code.includes(banned);
    });
    expect({ banned, line: at + 1 }).toEqual({ banned, line: 0 });
  }
});
