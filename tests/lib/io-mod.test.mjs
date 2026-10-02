// The hooks-module io over a small fake of the engine's `$`, with the shapes
// of the engine types (`FsStat`, `FsEntry`, `ProcessRunResult`,
// `SessionMessage`, `SessionUsage`).

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  platformOf,
  pluginDataDir,
  projectDirOf,
} from "../../hooks/lib/_io-mod.mjs";
import { modIo } from "../../hooks/register.mjs";

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
      exists: async (file) => {
        if (init.existsFails) throw new Error("refused");
        return files.has(file);
      },
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
      cwd: async () => {
        if (init.cwd instanceof Error) throw init.cwd;
        return "/work";
      },
      root: async () => {
        if (init.projectRoot instanceof Error) throw init.projectRoot;
        return init.projectRoot ?? "/proj";
      },
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
  const tmp = async (env) => (await modIo(fake({ env }).$)).tmp;
  expect(await tmp({ TMP: "/t1", TEMP: "/t2" })).toBe("/t1");
  expect(await tmp({ TEMP: "/t2" })).toBe("/t2");
});

test("cwd falls back to the project root, then to the hook input", async () => {
  const refused = new Error("refused");
  expect((await modIo(fake({ cwd: refused }).$)).cwd).toBe("/proj");
  const io = await modIo(
    fake({ cwd: refused, projectRoot: refused }).$,
    {},
    { cwd: "/in" },
  );
  expect(io.cwd).toBe("/in");
});

test("env holds the listed names, the made names, and the plugin options", async () => {
  const { $ } = fake({
    env: {
      HOME: "/h",
      CLAUDE_PROJECT_DIR: "/p",
      CLAUDE_PLUGIN_DATA: "/d",
      NOT_LISTED: "x",
    },
  });
  const io = await modIo($, {
    guard_bash: false,
    usage_scratchpad_prune_days: 7,
    model_allowed: "opus,sonnet",
    model_list: ["a", "b"],
    "odd-key.x": "y",
  });
  expect(io.env).toEqual({
    HOME: "/h",
    CLAUDE_PROJECT_DIR: "/proj",
    CLAUDE_PLUGIN_DATA: "/h/.claude/plugins/data/dotclaude-inline",
    CLAUDE_PLUGIN_OPTION_GUARD_BASH: "false",
    CLAUDE_PLUGIN_OPTION_USAGE_SCRATCHPAD_PRUNE_DAYS: "7",
    CLAUDE_PLUGIN_OPTION_MODEL_ALLOWED: "opus,sonnet",
    CLAUDE_PLUGIN_OPTION_MODEL_LIST: '["a","b"]',
    CLAUDE_PLUGIN_OPTION_ODD_KEY_X: "y",
  });
  const lost = await modIo(fake({ projectRoot: new Error("refused") }).$);
  expect(lost.env.CLAUDE_PROJECT_DIR).toBeUndefined();
});

/** The files of the guard closure, which the hooks module runs. */
function closureFiles() {
  const hooks = path.join(import.meta.dir, "../../hooks");
  const lib = fs
    .readdirSync(path.join(hooks, "lib"))
    .filter((name) => name.endsWith(".mjs"))
    .filter((name) => !["_io-node.mjs", "_common.mjs"].includes(name))
    .map((name) => path.join(hooks, "lib", name));
  const actions = [
    "pre-tool-use",
    "post-tool-use",
    "post-tool-use-failure",
    "subagent-start",
    "user-prompt-submit",
    "pre-compact",
  ].flatMap((dir) =>
    fs
      .readdirSync(path.join(hooks, dir))
      .filter((name) => name.endsWith(".mjs"))
      .map((name) => path.join(hooks, dir, name)),
  );
  return [...lib, ...actions];
}

const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("env reads every name that the closure reads", async () => {
  const reads = new Set();
  for (const file of closureFiles()) {
    const code = withoutComments(fs.readFileSync(file, "utf8"));
    for (const m of code.matchAll(
      /\benv\??\.([A-Z][A-Za-z0-9_]*)|\benv\[\s*["']([A-Z][A-Za-z0-9_]*)["']\s*\]/g,
    ))
      reads.add(m[1] ?? m[2]);
  }
  // An environment name starts with a capital letter. This keeps out a
  // method call on a local `env` string, such as `env.trim()`.
  expect(reads.size).toBeGreaterThan(20);
  const asked = new Set();
  const env = new Proxy(
    {},
    {
      get: (_, name) => {
        asked.add(name);
        return undefined;
      },
    },
  );
  await modIo(fake({ env }).$);
  // The io makes these from the engine, not from its environment.
  const made =
    /^(?:CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_DATA|CLAUDE_PLUGIN_OPTION_\w+)$/;
  expect(asked).not.toContain("CLAUDE_PROJECT_DIR");
  expect(asked).not.toContain("CLAUDE_PLUGIN_DATA");
  const missing = [...reads].filter(
    (name) => !asked.has(name) && !made.test(name),
  );
  expect(missing).toEqual([]);
});

test("CLAUDE_PLUGIN_DATA follows the data folder rule of Claude Code", () => {
  const env = { CLAUDE_CONFIG_DIR: "/cfg" };
  const home = "/home/me";
  const installed = (root) =>
    pluginDataDir({ platform: "posix", root, name: "dotclaude", env, home });
  expect(installed("/cfg/plugins/cache/dotclaude/dotclaude/0.18.0")).toBe(
    "/cfg/plugins/data/dotclaude-dotclaude",
  );
  expect(installed("/x/plugins/cache/my.market/dot claude/1.0.0/")).toBe(
    "/x/plugins/data/dot-claude-my-market",
  );
  expect(installed("/src/dotclaude")).toBe(
    "/cfg/plugins/data/dotclaude-inline",
  );
  const inline = (over) =>
    pluginDataDir({
      platform: "posix",
      root: "/src/dotclaude",
      name: "dotclaude",
      env: {},
      home,
      ...over,
    });
  expect(inline()).toBe("/home/me/.claude/plugins/data/dotclaude-inline");
  expect(inline({ env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: "/pc" } })).toBe(
    "/pc/data/dotclaude-inline",
  );
  expect(inline({ home: "" })).toBe("");
});

test("CLAUDE_PLUGIN_DATA on win32", async () => {
  expect(
    pluginDataDir({
      platform: "win32",
      root: "C:\\Users\\me\\.claude\\plugins\\cache\\dotclaude\\dotclaude\\0.18.0",
      name: "dotclaude",
      env: {},
      home: "C:\\Users\\me",
    }),
  ).toBe("C:\\Users\\me\\.claude\\plugins\\data\\dotclaude-dotclaude");
  const io = await modIo(
    fake({ root: "D:\\src\\dotclaude", env: { USERPROFILE: "C:\\Users\\me" } })
      .$,
  );
  expect(io.env.CLAUDE_PLUGIN_DATA).toBe(
    "C:\\Users\\me\\.claude\\plugins\\data\\dotclaude-inline",
  );
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
  const refused = await modIo(fake({ existsFails: true }).$);
  expect(await refused.fs.exists("/a")).toBe(false);
  expect(await io.fs.list("/d")).toEqual([
    { name: "a.json", kind: "file", isLink: false },
    { name: "sub", kind: "dir", isLink: false },
    { name: "ln", kind: "other", isLink: true },
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
  expect(runs[1].request).toEqual({ timeoutMs: 30_000, stdin: "" });
  await io.run(["tool"], { timeoutMs: 3_600_000 });
  expect(runs[2].request.timeoutMs).toBe(600_000);
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
  await expect(cut.run(["t"])).rejects.toThrow(
    "t: output passed the 4 MiB limit of the hooks engine for one stream",
  );
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

test("lastPrompt skips the summary of a compaction", async () => {
  const rows = [
    row("user", "yes, push it"),
    row("assistant", "a"),
    row(
      "user",
      "This session is being continued from a previous conversation. The user said: yes, delete it",
    ),
  ];
  const io = await modIo(fake({ mainRows: rows }).$);
  expect(await io.session.lastPrompt()).toBe("yes, push it");
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
  // No tag is no evidence: `messages()` can drop the notification row.
  expect(await io.session.agentStoppedAtLimit("a2")).toBeNull();
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

const hooksLib = path.join(import.meta.dir, "../../hooks/lib");

/** `_io-mod.mjs` and each file that it imports, also through other files. */
function ioModClosure() {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const m of source.matchAll(/^import[^;]*?from\s+"([^"]+)"/gm))
      visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(path.join(hooksLib, "_io-mod.mjs"));
  return [...seen];
}

test("_io-mod.mjs and its imports use no Node, Bun, process, or dynamic import", () => {
  const files = ioModClosure();
  expect(files.length).toBeGreaterThan(1);
  for (const file of files) {
    const code = withoutComments(fs.readFileSync(file, "utf8"));
    for (const banned of ["node:", "Bun.", "process.", "import("])
      expect({ file, banned, found: code.includes(banned) }).toEqual({
        file,
        banned,
        found: false,
      });
  }
});

test("_io-mod.mjs does not touch $, which the validator follows only in register.mjs", () => {
  const code = withoutComments(
    fs.readFileSync(path.join(hooksLib, "_io-mod.mjs"), "utf8"),
  );
  expect(code.includes("$.")).toBe(false);
});

test("projectDirOf gives the worktree of a subagent, and the root otherwise", () => {
  const tree = "/p/.claude/worktrees/agent-a1";
  expect(projectDirOf("posix", "/p", `${tree}/src`, "a1")).toBe(tree);
  expect(projectDirOf("posix", "/p", tree, undefined)).toBe("/p");
  expect(projectDirOf("posix", "/p", "/p/src", "a1")).toBe("/p");
  // A `WorktreeCreate` hook can put the worktree outside the root.
  expect(projectDirOf("posix", "/p", "/trees/w", "a1")).toBe("/trees/w");
  // A `cd` after the first call does not move the project.
  expect(projectDirOf("posix", "/p", "/tmp", "a1", "/trees/w")).toBe(
    "/trees/w",
  );
  expect(projectDirOf("posix", "/p", "/tmp", "a1", `${tree}/src`)).toBe(tree);
  expect(projectDirOf("posix", "/p", "/p/src", "a1", "/p")).toBe("/p");
  expect(projectDirOf("posix", "/p", "/p/..x", "a1")).toBe("/p");
  expect(
    projectDirOf("win32", "C:\\p", "C:\\p\\.claude\\worktrees\\w\\src", "a1"),
  ).toBe("C:\\p\\.claude\\worktrees\\w");
});
