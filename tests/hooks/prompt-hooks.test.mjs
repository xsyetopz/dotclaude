// User prompt hooks: inline skill expansion and CodeGraph symbol lists.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hook, repo } from "../support/hooks.mjs";

test("a /dotclaude: skill typed mid-message is expanded inline", () => {
  const expand = (prompt, env = {}) =>
    hook(
      "user-prompt-submit/expand-inline-skill.mjs",
      {
        hook_event_name: "UserPromptSubmit",
        prompt,
      },
      { CLAUDE_PLUGIN_ROOT: "", ...env },
    );
  const inline = expand(
    "look at the parser, then /dotclaude:challenge it",
  ).hookSpecificOutput;
  expect(inline.hookEventName).toBe("UserPromptSubmit");
  expect(inline.additionalContext).toMatch(
    /^\[dotclaude\] <skill name="dotclaude:challenge">\n[\s\S]*\n<\/skill>$/,
  );
  expect(inline.additionalContext).toMatch(/Idea: look at the parser, then it/);
  expect(inline.additionalContext).not.toMatch(/\$ARGUMENTS|^name:/m);
  expect(expand("/dotclaude:challenge the parser")).toBe(null);
  expect(expand("try /dotclaude:no-such-skill here")).toBe(null);
  const fork = expand("before merging, /dotclaude:review-code-changes")
    .hookSpecificOutput.additionalContext;
  // review-code-changes forks and is user-only, so the Skill tool would refuse it.
  expect(fork).toMatch(
    /send it again beginning with \/dotclaude:review-code-changes/,
  );
  expect(fork).not.toMatch(/<skill |Skill tool/);
  expect(
    expand(
      "<task-notification>\n<result>see /dotclaude:challenge</result>\n</task-notification>",
    ),
  ).toBe(null);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-plugin-"));
  const skill = (name, text) => {
    fs.mkdirSync(path.join(root, "skills", name), { recursive: true });
    fs.writeFileSync(
      path.join(root, "skills", name, "SKILL.md"),
      `---\nname: ${name}\n---\n${text}`,
    );
  };
  skill("big", "word $ARGUMENTS ".repeat(2000));
  skill("dynamic", "Status: !`git status --short`\nTarget: $ARGUMENTS");
  skill("prose", "Give the command with the `!` prefix. Target: $ARGUMENTS");
  const fixture = (prompt) =>
    expand(prompt, { CLAUDE_PLUGIN_ROOT: root }).hookSpecificOutput
      .additionalContext;
  const big = fixture("please /dotclaude:big now");
  expect(big.length <= 9500, String(big.length)).toBeTruthy();
  expect(big).toMatch(/Truncated at \d+ characters[\s\S]*<\/skill>$/);
  expect(big).toMatch(/word please now word/);
  expect(fixture("check /dotclaude:dynamic src")).toMatch(
    /Skill tool with skill "dotclaude:dynamic" and args "check src"/,
  );
  expect(fixture("see /dotclaude:prose here")).toMatch(/Target: see here/);
});

test("codegraph symbols lists indexed names from typed prompts only", () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-bin-"));
  // A fake `codegraph query --json` that knows one symbol, parseToken.
  fs.writeFileSync(
    path.join(bin, "codegraph"),
    `#!/bin/sh\nfor last; do :; done\nif [ "$last" = parseToken ]; then echo '[{"node":{"name":"parseToken","kind":"function","filePath":"src/auth.js","startLine":12}},{"node":{"name":"parseToken","kind":"import","filePath":"src/app.js","startLine":1}}]'; else echo '[]'; fi\n`,
    { mode: 0o755 },
  );
  fs.mkdirSync(path.join(repo, ".codegraph"), { recursive: true });
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const ask = (prompt, extra = {}) =>
    hook(
      "user-prompt-submit/codegraph-symbols.mjs",
      { hook_event_name: "UserPromptSubmit", prompt },
      { ...env, ...extra },
    );
  const out = ask("how does parseToken reach renderPage?").hookSpecificOutput
    .additionalContext;
  expect(out).toMatch(/- parseToken \(function, src\/auth\.js:12\)/);
  expect(out).not.toMatch(/import|renderPage \(/);
  expect(out.length < 1000, out).toBeTruthy();
  expect(ask("how does the login flow work?")).toBe(null);
  expect(ask("see README.md and docs/setup.md")).toBe(null);
  expect(
    ask(
      "<task-notification>\n<summary>parseToken done</summary>\n</task-notification>",
    ),
  ).toBe(null);
  expect(
    ask("how does parseToken work?", {
      CLAUDE_PLUGIN_OPTION_CODEGRAPH_HINT: "false",
    }),
  ).toBe(null);
});
