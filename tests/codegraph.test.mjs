import { expect, test } from "bun:test";
import { CODEGRAPH_SYNC_TIMEOUT_MS } from "../hooks/lib/_budget.mjs";
import {
  graphNote,
  indexState,
  searchSymbol,
} from "../hooks/lib/_codegraph.mjs";
import { register } from "../hooks/register.mjs";

const STATUS_OK = JSON.stringify({
  initialized: true,
  pendingChanges: { added: 0, modified: 0, removed: 0 },
  index: { reindexRecommended: false },
});
const STATUS_STALE = JSON.stringify({
  initialized: true,
  pendingChanges: { added: 1, modified: 2, removed: 0 },
});
const CALLERS = JSON.stringify({
  symbol: "parseConfig",
  callers: [
    { name: "main", kind: "function", filePath: "src/main.ts", startLine: 4 },
    { name: "src/cli.ts", kind: "file", filePath: "src/cli.ts", startLine: 1 },
  ],
});
const CALLEES = JSON.stringify({
  symbol: "parseConfig",
  callees: [
    { name: "readFile", kind: "function", filePath: "src/io.ts", startLine: 9 },
  ],
});

/**
 * A fake of the engine's `import { expect, test } from "bun:test";
import { CODEGRAPH_SYNC_TIMEOUT_MS } from "../hooks/lib/_budget.mjs";
import {
  graphNote,
  indexState,
  searchSymbol,
} from "../hooks/lib/_codegraph.mjs";
import { register } from "../hooks/register.mjs";

const STATUS_OK = JSON.stringify({
  initialized: true,
  pendingChanges: { added: 0, modified: 0, removed: 0 },
  index: { reindexRecommended: false },
});
const STATUS_STALE = JSON.stringify({
  initialized: true,
  pendingChanges: { added: 1, modified: 2, removed: 0 },
});
const CALLERS = JSON.stringify({
  symbol: "parseConfig",
  callers: [
    { name: "main", kind: "function", filePath: "src/main.ts", startLine: 4 },
    { name: "src/cli.ts", kind: "file", filePath: "src/cli.ts", startLine: 1 },
  ],
});
const CALLEES = JSON.stringify({
  symbol: "parseConfig",
  callees: [
    { name: "readFile", kind: "function", filePath: "src/io.ts", startLine: 9 },
  ],
});

/**
 whose `codegraph` answers from `status` and `symbols`.
 * It is a test double: it runs no process.
 */
function engine({
  status = STATUS_OK,
  symbols = ["parseConfig"],
  syncExit = 0,
} = {}) {
  const calls = [];
  const answer = ([, sub, symbol]) => {
    if (sub === "status") return status;
    if (sub === "sync") return "Synced";
    if (!symbols.includes(symbol)) return `ℹ Symbol "${symbol}" not found`;
    return sub === "callers" ? CALLERS : CALLEES;
  };
  return {
    calls,
    $: {
      session: { cwd: async () => "/work/app", root: async () => "/work/app" },
      env: { get: async () => undefined },
      fs: { read: async () => "" },
      process: {
        run: async (argv, init) => {
          calls.push({ argv, init });
          if (argv[0] !== "codegraph") return { exitCode: 0, stdout: "[]" };
          if (status === null) throw new Error("codegraph not found");
          const exitCode = argv[1] === "sync" ? syncExit : 0;
          if (argv[1] === "sync" && !exitCode) status = STATUS_OK;
          return { exitCode, stdout: answer(argv) };
        },
      },
    },
  };
}

function load(options = {}) {
  const handlers = {};
  register((event, fn) => {
    handlers[event] = fn;
  }, options);
  return handlers["tool.call"];
}

const search = (onCall, $, e, result = { result: "src/a.ts:1: hit" }) =>
  onCall($, { tool_use_id: "t1", ...e }, async () => result);

const graphCalls = (calls) => calls.filter((c) => c.argv[0] === "codegraph");
const subcommands = (calls, sub) =>
  graphCalls(calls).filter((c) => c.argv[1] === sub);

test("the symbol of a search is a single name, and nothing else", () => {
  const bash = (command) => searchSymbol({ tool: "Bash", command });
  expect(searchSymbol({ tool: "Grep", pattern: "parseConfig" })).toBe(
    "parseConfig",
  );
  expect(searchSymbol({ tool: "Grep", pattern: "\\bparseConfig\\b" })).toBe(
    "parseConfig",
  );
  expect(bash("rg -n parseConfig src")).toBe("parseConfig");
  expect(bash('rg -n -t ts "parseConfig" src')).toBe("parseConfig");
  expect(bash("rg --glob '*.ts' -w parseConfig")).toBe("parseConfig");
  expect(bash("grep -rn -e parseConfig .")).toBe("parseConfig");
  expect(bash("cd src && rg -l parseConfig | head")).toBe("parseConfig");
  expect(searchSymbol({ tool: "Grep", pattern: "parse.*Config" })).toBe(
    undefined,
  );
  expect(searchSymbol({ tool: "Grep", pattern: "ab" })).toBe(undefined);
  expect(bash('rg "load config" src')).toBe(undefined);
  expect(bash("ls src | grep")).toBe(undefined);
  expect(bash("git log -n 3")).toBe(undefined);
  expect(searchSymbol({ tool: "Glob", pattern: "parseConfig" })).toBe(
    undefined,
  );
});

test("the note names callers and callees and leaves out file nodes", () => {
  const note = graphNote("parseConfig", CALLERS, CALLEES);
  expect(note).toContain("Called by: main (src/main.ts:4)");
  expect(note).toContain("Calls: readFile (src/io.ts:9)");
  expect(note).not.toContain("src/cli.ts");
  expect(graphNote("x", 'ℹ Symbol "x" not found', "")).toBe(undefined);
});

test("the index state reads the CodeGraph status", () => {
  expect(indexState(STATUS_OK).state).toBe("ok");
  expect(indexState(JSON.stringify({ initialized: false })).state).toBe("none");
  expect(indexState(undefined).state).toBe("none");
  const stale = indexState(STATUS_STALE);
  expect(stale.state).toBe("stale");
  expect(stale.pending).toBe(true);
  expect(stale.note).toContain("3 changed file(s)");
  const old = indexState(
    JSON.stringify({ initialized: true, index: { reindexRecommended: true } }),
  );
  expect(old.state).toBe("stale");
  expect(old.pending).toBe(false);
});

test("a search for a symbol gets its call paths once", async () => {
  const { $, calls } = engine();
  const onCall = load();
  const r = await search(onCall, $, {
    tool: "Bash",
    command: "rg -n parseConfig",
  });
  expect(r.result).toBe("src/a.ts:1: hit");
  expect(r.context).toHaveLength(1);
  expect(r.context[0]).toContain("Called by: main");
  expect(graphCalls(calls).every((c) => c.init.cwd === "/work/app")).toBe(true);
  const again = await search(onCall, $, {
    tool: "Grep",
    pattern: "parseConfig",
  });
  expect(again.context).toBeUndefined();
  const agent = await search(onCall, $, {
    tool: "Grep",
    pattern: "parseConfig",
    agentId: "a1",
  });
  expect(agent.context).toHaveLength(1);
  expect(subcommands(calls, "status")).toHaveLength(2);
  expect(subcommands(calls, "sync")).toHaveLength(0);
});

test("a stale index is synced before the lookup, once for parallel searches", async () => {
  const { $, calls } = engine({ status: STATUS_STALE });
  const onCall = load();
  const [first, second] = await Promise.all([
    search(onCall, $, { tool: "Grep", pattern: "parseConfig" }),
    search(onCall, $, { tool: "Grep", pattern: "parseConfig", agentId: "a1" }),
  ]);
  const syncs = subcommands(calls, "sync");
  expect(syncs).toHaveLength(1);
  expect(syncs[0].init.timeoutMs).toBe(CODEGRAPH_SYNC_TIMEOUT_MS);
  expect(calls.indexOf(syncs[0])).toBeLessThan(
    calls.indexOf(subcommands(calls, "callers")[0]),
  );
  for (const r of [first, second]) {
    expect(r.context).toHaveLength(1);
    expect(r.context[0]).toContain("Called by: main");
  }
});

test("a failed sync gives one stale note and no second sync", async () => {
  const { $, calls } = engine({ status: STATUS_STALE, syncExit: 1 });
  const onCall = load();
  const first = await search(onCall, $, {
    tool: "Grep",
    pattern: "parseConfig",
  });
  expect(first.context).toHaveLength(2);
  expect(first.context[0]).toContain("`codegraph sync`");
  const second = await search(onCall, $, { tool: "Grep", pattern: "loadAll" });
  expect(second.context).toBeUndefined();
  expect(subcommands(calls, "sync")).toHaveLength(1);
});

test("nothing is added without an index, a CLI, a symbol, or the option", async () => {
  const cases = [
    [engine({ status: JSON.stringify({ initialized: false }) }), {}],
    [engine({ status: null }), {}],
    [engine({ symbols: [] }), {}],
    [engine(), { codegraph: false }],
  ];
  for (const [{ $ }, options] of cases) {
    const r = await search(load(options), $, {
      tool: "Grep",
      pattern: "parseConfig",
    });
    expect(r.context).toBeUndefined();
  }
  const { $, calls } = engine();
  await search(load(), $, { tool: "Grep", pattern: "parse.*Config" });
  expect(graphCalls(calls)).toHaveLength(0);
  const failed = { result: "error", isError: true };
  const r = await search(
    load(),
    $,
    { tool: "Grep", pattern: "parseConfig" },
    failed,
  );
  expect(r).toBe(failed);
});
