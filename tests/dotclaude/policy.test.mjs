// The project AI policy guard: the repositories and paths of a call, the ask
// before the first call that reaches a project with a policy file, the note
// after a fetch, and the clause for the main agent and each subagent. Each
// `gh` and `git` call is a fake, so no test reaches the network.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "../../plugins/dotclaude/hooks/module/index.mjs";
import { policyAsk } from "../../plugins/dotclaude/hooks/pre-tool-use/ask-guarded-calls.mjs";
import { contextFor } from "../../plugins/dotclaude/hooks/session-start/add-session-context.mjs";
import { SUBAGENT_CONTEXT } from "../../plugins/dotclaude/hooks/subagent-start/add-subagent-context.mjs";
import {
  fetchedRepos,
  outsidePaths,
  POLICY_CLAUSE,
  policyNote,
  policyReason,
  within,
} from "../../plugins/dotclaude/lib/guards/policy.mjs";
import { clauseTag, TERMS_OF_USE } from "../../plugins/dotclaude/lib/terms.mjs";

const POLICY = "Do not read, open, search, or run any file in this repository.";

test("each GitHub fetch form names its repository", () => {
  const bash = (command) => fetchedRepos("Bash", { command });
  expect(bash("git clone https://github.com/Owner/Repo.git /tmp/r")).toEqual([
    "owner/repo",
  ]);
  expect(bash("gh repo clone owner/repo")).toEqual(["owner/repo"]);
  expect(
    bash("gh api repos/owner/repo/contents/src/a.cpp --jq .content"),
  ).toEqual(["owner/repo"]);
  expect(
    bash("curl -sL https://raw.githubusercontent.com/owner/repo/main/a.c"),
  ).toEqual(["owner/repo"]);
  expect(
    fetchedRepos("WebFetch", {
      url: "https://github.com/owner/repo/blob/main/src/a.c",
    }),
  ).toEqual(["owner/repo"]);
});

test("a call that fetches nothing names no repository", () => {
  expect(fetchedRepos("Bash", { command: "git push origin main" })).toEqual([]);
  expect(
    fetchedRepos("Bash", { command: "echo https://github.com/owner/repo" }),
  ).toEqual([]);
  expect(fetchedRepos("WebFetch", { url: "https://example.com/a" })).toEqual(
    [],
  );
});

test("only paths outside the project count", () => {
  expect(
    outsidePaths("Read", { file_path: "/work/app/a.js" }, "/work/app", "/h"),
  ).toEqual([]);
  expect(
    outsidePaths("Grep", { path: "/tmp/r/src" }, "/work/app", "/h"),
  ).toEqual(["/tmp/r/src"]);
  expect(
    outsidePaths(
      "Bash",
      { command: "cat /tmp/r/a.c ~/x/b.c /work/app/c" },
      "/work/app",
      "/h",
    ),
  ).toEqual(["/tmp/r/a.c", "/h/x/b.c"]);
  expect(
    outsidePaths(
      "Bash",
      { command: "type C:\\r\\a.c d:/work/app/b.c" },
      "D:\\work\\app",
      "C:\\h",
    ),
  ).toEqual(["C:\\r\\a.c"]);
  expect(
    outsidePaths("Read", { file_path: "D:\\work\\app\\a.js" }, "D:\\work\\app"),
  ).toEqual([]);
  expect(within("D:/work/app", "D:\\work\\app\\")).toBe(true);
  expect(within("/work/apps", "/work/app")).toBe(false);
});

test("the reason and the note show the policy, and no file gives nothing", () => {
  const reason = policyReason("owner/repo", [POLICY, null, null]);
  expect(reason).toContain("`owner/repo`");
  expect(reason).toContain("`CLAUDE.md`");
  expect(reason).toContain(POLICY);
  const note = policyNote("owner/repo", [null, POLICY, null]);
  expect(note).toStartWith(clauseTag("project-ai-policy"));
  expect(note).toContain('<policy_file name="AGENTS.md">');
  expect(policyReason("owner/repo", [null, " ", null])).toBeUndefined();
  expect(policyNote("owner/repo", [null, null, null])).toBeUndefined();
});

/** A fake `exec`: `gh` gives `login` and the policy of `owner/repo`. */
function fakeExec({ login = "me", git = {} } = {}) {
  const calls = [];
  const exec = async (argv, cwd) => {
    calls.push(argv.join(" "));
    if (argv[0] === "gh" && argv[1] === "config") return `${login}\n`;
    if (argv.at(-1) === "repos/owner/repo/contents/CLAUDE.md") return POLICY;
    if (argv[0] === "git") return git[`${argv.slice(1).join(" ")} @ ${cwd}`];
    return null;
  };
  return { exec, calls };
}

const env = () => ({
  HOME: "/h",
  CLAUDE_PROJECT_DIR: "/work/app",
  CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), "policy-")),
});

const fetch = (session_id) => ({
  session_id,
  tool_name: "Bash",
  tool_input: { command: "gh api repos/owner/repo/contents/src/a.cpp" },
});

test("the first fetch from a repository with a policy asks, once per session", async () => {
  const e = env();
  const { exec } = fakeExec();
  expect(await policyAsk(fetch("s1"), e, exec)).toContain(POLICY);
  expect(await policyAsk(fetch("s1"), e, exec)).toBeUndefined();
  expect(await policyAsk(fetch("s2"), e, exec)).toContain(POLICY);
});

test("a repository of the user or with no policy does not ask", async () => {
  const own = fakeExec({ login: "owner" });
  expect(await policyAsk(fetch("s1"), env(), own.exec)).toBeUndefined();
  const other = {
    ...fetch("s1"),
    tool_input: { command: "gh repo clone other/thing" },
  };
  expect(await policyAsk(other, env(), fakeExec().exec)).toBeUndefined();
});

test("the option turns the ask off", async () => {
  const { exec, calls } = fakeExec();
  const off = { ...env(), CLAUDE_PLUGIN_OPTION_GUARD_POLICY: "false" };
  expect(await policyAsk(fetch("s1"), off, exec)).toBeUndefined();
  expect(calls).toEqual([]);
});

test("a path in a clone of another owner with a policy file asks", async () => {
  const root = mkdtempSync(join(tmpdir(), "clone-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "CLAUDE.md"), POLICY);
  const src = join(root, "src");
  const git = (remote) => ({
    [`rev-parse --show-toplevel @ ${src}`]: `${root}\n`,
    [`remote -v @ ${root}`]: remote,
  });
  const read = { tool_name: "Read", tool_input: { file_path: `${src}/a.c` } };
  const other = fakeExec({
    git: git("origin https://github.com/owner/repo (fetch)\n"),
  });
  expect(await policyAsk(read, env(), other.exec)).toContain(POLICY);
  const local = fakeExec({ git: git("") });
  expect(await policyAsk(read, env(), local.exec)).toBeUndefined();
  const own = fakeExec({
    git: git("origin https://github.com/me/repo (fetch)\n"),
  });
  expect(await policyAsk(read, env(), own.exec)).toBeUndefined();
});

test("after a fetch, the module adds the policy once for each context", async () => {
  let handler;
  register((event, fn) => {
    if (event === "tool.call") handler = fn;
  }, {});
  const runs = [];
  // A fake of the engine's `$`. It is a test double, not the real engine.
  const $ = {
    session: { cwd: async () => "/work/app", root: async () => "/work/app" },
    env: { get: async () => undefined },
    fs: { read: async () => Promise.reject(new Error("missing")) },
    process: {
      run: async (argv) => {
        runs.push(argv);
        return argv.at(-1) === "repos/owner/repo/contents/CLAUDE.md"
          ? { exitCode: 0, stdout: POLICY }
          : { exitCode: 1, stdout: "" };
      },
    },
  };
  const e = { tool: "WebFetch", url: "https://github.com/owner/repo/a" };
  const call = (x) => handler($, x, async () => ({ result: "page" }));
  const first = await call(e);
  expect(first.context.join("\n")).toContain(POLICY);
  expect((await call(e)).context).toBeUndefined();
  const sub = await call({ ...e, agentId: "a1" });
  expect(sub.context.join("\n")).toContain(POLICY);
});

test("the main agent and each subagent get the clause", () => {
  expect(POLICY_CLAUSE).toStartWith(clauseTag("project-ai-policy"));
  expect(POLICY_CLAUSE).not.toContain(";");
  expect(SUBAGENT_CONTEXT).toBe(`${TERMS_OF_USE}\n\n${POLICY_CLAUSE}`);
  const root = mkdtempSync(join(tmpdir(), "ss-"));
  expect(contextFor({ source: "startup" }, root, "max")).toContain(
    POLICY_CLAUSE,
  );
  const script = join(
    import.meta.dir,
    "../../plugins/dotclaude/hooks/subagent-start/add-subagent-context.mjs",
  );
  const out = JSON.parse(
    spawnSync("bun", [script], { encoding: "utf8" }).stdout,
  );
  expect(out.hookSpecificOutput).toEqual({
    hookEventName: "SubagentStart",
    additionalContext: SUBAGENT_CONTEXT,
  });
});
