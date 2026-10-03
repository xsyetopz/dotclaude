// Nested CLAUDE.md files for Bash reads (#90450): the hook adds the files a
// Read of the same paths would load, once per session or subagent.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NESTED_INSTRUCTIONS_CHARS } from "../../hooks/lib/_budget.mjs";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";
import {
  contextFor,
  instructionFiles,
  readPaths,
} from "../../hooks/lib/_nested-instructions.mjs";
import { hook, repo, session } from "../support/hooks.mjs";

const HOOK = "post-tool-use/load-nested-instructions.mjs";
const put = (rel, text) => {
  const f = path.join(repo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};

put("CLAUDE.md", "root rules");
put("pkg/CLAUDE.md", "pkg rules");
put("pkg/.claude/CLAUDE.md", "pkg dot-claude rules");
put("pkg/api/CLAUDE.local.md", "api local rules");
put("pkg/api/server.ts", "export {}");
put("docs/readme.txt", "no rules here");

const bash = (sid, command, extra = {}) =>
  hook(HOOK, {
    session_id: sid,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout: "", stderr: "" },
    ...extra,
  });
const context = (out) => out?.hookSpecificOutput?.additionalContext ?? "";

test("reader commands name existing paths inside the project only", async () => {
  const paths = await readPaths(
    nodeIo(),
    "cd pkg && sed -n 1,20p api/server.ts; rg foo api missing /etc/hosts; ls docs",
    repo,
    repo,
  );
  expect(paths).toEqual([
    path.join(repo, "pkg/api/server.ts"),
    path.join(repo, "pkg/api"),
  ]);
});

test("instruction files run from below the root down to the file's directory", async () => {
  expect(
    (
      await instructionFiles(
        nodeIo(),
        path.join(repo, "pkg/api/server.ts"),
        repo,
      )
    ).map((f) => path.relative(repo, f).split(path.sep).join("/")),
  ).toEqual([
    "pkg/CLAUDE.md",
    "pkg/.claude/CLAUDE.md",
    "pkg/api/CLAUDE.local.md",
  ]);
  expect(
    await instructionFiles(nodeIo(), path.join(repo, "docs/readme.txt"), repo),
  ).toEqual([]);
});

test("a worktree of the project is a root, and a submodule is not", async () => {
  // `git worktree add` writes a `.git` file that points into the project's `.git/worktrees/`.
  const wt = ".claude/worktrees/wt";
  put(`${wt}/.git`, `gitdir: ${path.join(repo, ".git/worktrees/wt")}\n`);
  put(`${wt}/CLAUDE.md`, "root rules");
  put(`${wt}/pkg/CLAUDE.md`, "pkg rules");
  put(`${wt}/pkg/a.ts`, "export {}");
  // A submodule's `.git` file points into `.git/modules/`, and its rules are its own.
  put("vendor/lib/.git", "gitdir: ../../.git/modules/lib\n");
  put("vendor/lib/CLAUDE.md", "lib rules");
  put("vendor/lib/a.ts", "export {}");
  const rel = async (file) =>
    (await instructionFiles(nodeIo(), path.join(repo, file), repo)).map((f) =>
      path.relative(repo, f).split(path.sep).join("/"),
    );
  expect(await rel(`${wt}/pkg/a.ts`)).toEqual([`${wt}/pkg/CLAUDE.md`]);
  expect(await rel(`${wt}/CLAUDE.md`)).toEqual([]);
  expect(await rel("vendor/lib/a.ts")).toEqual(["vendor/lib/CLAUDE.md"]);
  fs.rmSync(path.join(repo, ".claude"), { recursive: true });
  fs.rmSync(path.join(repo, "vendor"), { recursive: true });
});

test("a file past the size bound is named for the Read tool", async () => {
  const big = put("big/CLAUDE.md", "x".repeat(NESTED_INSTRUCTIONS_CHARS + 1));
  const text = await contextFor(
    nodeIo(),
    [path.join(repo, "pkg/CLAUDE.md"), big],
    repo,
  );
  expect(text).toContain("pkg rules");
  // The big file is named by its path, and its text is not added.
  expect(text).toContain("`big/CLAUDE.md`");
  expect(text).not.toContain("xxxx");
});

test("the hook adds the files once per session", () => {
  const sid = session();
  const first = context(bash(sid, "cat pkg/api/server.ts"));
  expect(first).toStartWith("[dotclaude]");
  expect(first).toContain("pkg rules");
  expect(first).toContain("api local rules");
  expect(first).not.toContain("root rules");
  expect(bash(sid, "head -5 pkg/api/server.ts")).toBeNull();
  // A subagent has its own context, so it gets them again.
  expect(
    context(bash(sid, "cat pkg/api/server.ts", { agent_id: "a1" })),
  ).toContain("pkg rules");
});

test("files the transcript shows Claude Code loaded are skipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-nested-"));
  const transcript = path.join(dir, "t.jsonl");
  fs.writeFileSync(
    transcript,
    `${JSON.stringify({
      type: "attachment",
      attachment: {
        type: "nested_memory",
        path: path.join(repo, "pkg/CLAUDE.md"),
        content: {},
      },
    })}\n`,
  );
  const text = context(
    bash(session(), "cat pkg/api/server.ts", { transcript_path: transcript }),
  );
  expect(text).not.toContain("pkg rules");
  expect(text).toContain("api local rules");
  fs.rmSync(dir, { recursive: true });
});

test("other commands and the option turned off add nothing", () => {
  expect(bash(session(), "ls pkg/api")).toBeNull();
  expect(bash(session(), "cat docs/readme.txt")).toBeNull();
  expect(
    hook(
      HOOK,
      {
        session_id: session(),
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "cat pkg/api/server.ts" },
      },
      { CLAUDE_PLUGIN_OPTION_CONTEXT_NESTED_INSTRUCTIONS: "false" },
    ),
  ).toBeNull();
});
