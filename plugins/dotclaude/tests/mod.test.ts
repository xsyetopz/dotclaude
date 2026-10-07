// The hook lab of dotclaude: `claude plugin test plugins/dotclaude` loads `hooks/mod.mjs`,
// fires `tool.check` events, and stubs each answer of Claude Code.
// No command runs, no session starts, and no network call goes out.

import { expect, mock, test } from "claude-code/testing";

const ROOT = "/work/app";

/** Stubs for one test: the engine verdict, the session, and `gh` output by argument list. */
function stub(on, { verdict = "allow", gh = {} } = {}) {
  on("tool.check", () => ({ decision: verdict }));
  mock.env(on, { HOME: "/home/me", TMPDIR: "/var/tmp/me" });
  on("session.cwd", () => ({ value: ROOT }));
  on("session.root", () => ({ value: ROOT }));
  on("session.id", () => ({ value: "s1" }));
  on("process.run", (_$, e) => {
    const out = gh[e.argv.join(" ")];
    return {
      value:
        out === undefined
          ? { exitCode: 1, stdout: "", stderr: "not found" }
          : { exitCode: 0, stdout: out, stderr: "" },
    };
  });
}

const bash = ($, command) => $.tool.check({ tool: "Bash", input: { command } });

test("a recursive rm outside the project asks", async ($, on) => {
  stub(on);
  const out = await bash($, "rm -rf ../other");
  expect(out.decision).toBe("ask");
  expect(out.reason).toContain("`../other`");
});

test("a recursive rm in the project or in a temp folder keeps the verdict", async ($, on) => {
  stub(on);
  for (const command of [
    "rm -rf ./build",
    "rm -r node_modules dist",
    "rm -rf /tmp/x",
    "rm -rf /var/tmp/me/x",
    "rm file.txt",
  ])
    expect((await bash($, command)).decision).toBe("allow");
});

test("a deny of the engine stays a deny", async ($, on) => {
  stub(on, { verdict: "deny" });
  expect((await bash($, "rm -rf ~/x")).decision).toBe("deny");
});

test("with DISABLE_COMPACT, the context_management section says that compaction is off", async ($, on) => {
  on("prompt.section", () => ({ text: "is summarized" }));
  mock.env(on, { DISABLE_COMPACT: "1" });
  const out = await $.prompt.section({
    name: "context_management",
    text: null,
  });
  expect(out.text).toContain("Compaction is off");
  expect(out.text).not.toBe("is summarized");
});

test("another section keeps the text of the engine", async ($, on) => {
  on("prompt.section", () => ({ text: "is summarized" }));
  mock.env(on, { DISABLE_COMPACT: "1" });
  expect((await $.prompt.section({ name: "memory", text: null })).text).toBe(
    "is summarized",
  );
});

test("with DISABLE_COMPACT=0, the context_management text of the engine stays", async ($, on) => {
  on("prompt.section", () => ({ text: "is summarized" }));
  mock.env(on, { DISABLE_COMPACT: "0" });
  const out = await $.prompt.section({
    name: "context_management",
    text: null,
  });
  expect(out.text).toBe("is summarized");
});

const LOGIN = "gh config get user -h github.com";
const POLICY = (repo) =>
  `gh api -H Accept: application/vnd.github.raw+json repos/${repo}/contents/CLAUDE.md`;

test("the first call to a repository of another owner with a policy asks once", async ($, on) => {
  stub(on, {
    gh: { [LOGIN]: "me\n", [POLICY("other/lib")]: "No AI pull requests." },
  });
  const first = await bash($, "gh repo view other/lib");
  expect(first.decision).toBe("ask");
  expect(first.reason).toContain("No AI pull requests.");
  expect((await bash($, "gh repo view other/lib")).decision).toBe("allow");
});

test("a repository of the user, or one with no policy, keeps the verdict", async ($, on) => {
  stub(on, {
    gh: { [LOGIN]: "me\n", [POLICY("me/app")]: "Rules of my own." },
  });
  expect((await bash($, "gh repo view me/app")).decision).toBe("allow");
  expect(
    (
      await $.tool.check({
        tool: "WebFetch",
        input: { url: "https://github.com/nobody/empty" },
      })
    ).decision,
  ).toBe("allow");
});
