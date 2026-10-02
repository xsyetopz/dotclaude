// The io paths of the AI policy catalog and the contribution guard, with a
// fake io object. Nothing is executed and nothing reaches the network.

import { beforeEach, describe, expect, test } from "bun:test";
import {
  loadCatalog,
  lookup,
  refreshUpstream,
  resetCatalogCache,
} from "../../hooks/lib/_ai-policies.mjs";
import { check } from "../../hooks/lib/_bash-rules.mjs";

const SHIPPED = "/plugin/hooks/lib/_ai-policies.json";

/**
 * A plain io object. `files` maps a path to its text or to a function that
 * gives the text or throws. `runs` collects the argv of every `run` call, and
 * `answer` gives the result of one.
 */
function fakeIo({ files = {}, env = {}, answer } = {}) {
  const runs = [];
  const io = {
    env,
    home: "/home/me",
    tmp: "/tmp",
    cwd: "/work",
    pluginRoot: "/plugin",
    platform: "posix",
    fs: {
      read: async (path) => {
        const file = files[path];
        if (file === undefined) throw new Error(`ENOENT ${path}`);
        return typeof file === "function" ? file() : file;
      },
      write: async (path, text) => {
        files[path] = text;
      },
    },
    run: async (argv) => {
      runs.push(argv);
      return answer(argv);
    },
  };
  return { io, runs, files };
}

const catalog = (...keys) =>
  JSON.stringify({
    sha: "x",
    entries: keys.map((key) => ({
      project: key,
      allowed: "Yes",
      keys: [key],
    })),
  });

beforeEach(() => resetCatalogCache());

describe("gh login", () => {
  const command = "gh issue create -R other/thing --title t";
  const ctxFor = (io) => ({
    root: "/work",
    cwd: "/work",
    allowedModels: ["claude-opus-5-5"],
    io,
  });
  const asks = async (io) =>
    (await check(command, ctxFor(io))).some(
      ([level, reason]) =>
        level === "ask" && reason.includes("that you do not own"),
    );
  const ghAnswer = (calls) => async (argv) => {
    if (argv[0] === "gh") return calls.shift();
    return { exitCode: 1, stdout: "", stderr: "" };
  };

  test("gh that exits non-zero gives no login and is asked again", async () => {
    const calls = [
      { exitCode: 1, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "Me\n", stderr: "" },
    ];
    const { io, runs } = fakeIo({ answer: ghAnswer(calls) });
    expect(await asks(io)).toBe(false);
    expect(await asks(io)).toBe(true);
    expect(runs.filter(([name]) => name === "gh")).toHaveLength(2);
  });

  test("a gh that cannot start gives no login and is asked again", async () => {
    let first = true;
    const { io, runs } = fakeIo({
      answer: async (argv) => {
        if (argv[0] !== "gh") return { exitCode: 1, stdout: "", stderr: "" };
        if (first) {
          first = false;
          throw new Error("spawn gh ENOENT");
        }
        return { exitCode: 0, stdout: "me\n", stderr: "" };
      },
    });
    expect(await asks(io)).toBe(false);
    expect(await asks(io)).toBe(true);
    expect(runs.filter(([name]) => name === "gh")).toHaveLength(2);
  });

  test("two ios with different gh config dirs have their own login", async () => {
    const hosts = (user) => `github.com:\n  user: ${user}\n`;
    const a = fakeIo({
      env: { GH_CONFIG_DIR: "/a" },
      files: { "/a/hosts.yml": hosts("other") },
      answer: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
    });
    const b = fakeIo({
      env: { GH_CONFIG_DIR: "/b" },
      files: { "/b/hosts.yml": hosts("me") },
      answer: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
    });
    expect(await asks(a.io)).toBe(false);
    expect(await asks(b.io)).toBe(true);
  });
});

describe("refreshUpstream", () => {
  test("curl that exits non-zero leaves the stored hash", async () => {
    const state = "/data/ai-policies-upstream.json";
    const { io, runs, files } = fakeIo({
      env: { CLAUDE_PLUGIN_DATA: "/data" },
      files: { [state]: JSON.stringify({ checked: 0, sha: "old" }) },
      answer: async () => ({ exitCode: 22, stdout: "", stderr: "" }),
    });
    await refreshUpstream(io, 10 * 24 * 60 * 60 * 1000);
    expect(runs.map(([name]) => name)).toEqual(["curl"]);
    expect(JSON.parse(files[state]).sha).toBe("old");
  });
});

describe("catalog cache", () => {
  test("a read that fails once is tried again", async () => {
    let fail = true;
    const { io } = fakeIo({
      files: {
        [SHIPPED]: () => {
          if (fail) {
            fail = false;
            throw new Error("EIO");
          }
          return catalog("github.com/a/b");
        },
      },
    });
    expect(await lookup(io, "github.com/a/b")).toBeUndefined();
    expect((await lookup(io, "github.com/a/b"))?.project).toBe(
      "github.com/a/b",
    );
  });

  test("two ios with different data dirs get their own entries", async () => {
    const one = fakeIo({
      env: { CLAUDE_PLUGIN_DATA: "/one" },
      files: { "/one/ai-policies.json": catalog("github.com/one/x") },
    });
    const two = fakeIo({
      env: { CLAUDE_PLUGIN_DATA: "/two" },
      files: { "/two/ai-policies.json": catalog("github.com/two/x") },
    });
    expect((await loadCatalog(one.io)).file).toBe("/one/ai-policies.json");
    expect(await lookup(two.io, "github.com/one/x")).toBeUndefined();
    expect((await lookup(two.io, "github.com/two/x"))?.project).toBe(
      "github.com/two/x",
    );
  });

  test("an entry without keys does not throw", async () => {
    const { io } = fakeIo({
      files: { [SHIPPED]: '{"entries":[{}, {"keys":["github.com/a/b"]}]}' },
    });
    expect(await lookup(io, "github.com/zzz/y")).toBeUndefined();
    expect(await lookup(io, "github.com/a/b")).toBeDefined();
  });
});
