import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "../../plugins/dotclaude/hooks/module/index.mjs";

const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

/** A fake of the engine's `$`. It is a test double, not the real engine. */
function engine({ report = "[]", scanFails = false } = {}) {
  const calls = [];
  return {
    calls,
    $: {
      session: { cwd: async () => "/work/app", root: async () => "/work/app" },
      env: { get: async (name) => ({ HOME: "/home/u" })[name] },
      fs: {
        read: async () => {
          throw new Error("missing");
        },
      },
      process: {
        run: async (argv, init) => {
          calls.push({ argv, init });
          if (scanFails) throw new Error("not found");
          return { exitCode: 0, stdout: report, stderr: "" };
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
  return handlers;
}

/** Runs `tool.call` with a `next` that asks `tool.check`, as the engine does. */
async function call(handlers, $, e, result = { result: "ok" }) {
  let verdict;
  const r = await handlers["tool.call"](
    $,
    { tool_use_id: "t1", ...e },
    async () => {
      verdict = await handlers["tool.check"](
        $,
        e && { tool_use_id: "t1", ...e },
        async () => ({ decision: "allow" }),
      );
      return result;
    },
  );
  return { r, verdict };
}

test("hooks.json names the module, PreToolUse, SessionStart, and SubagentStart", () => {
  const json = JSON.parse(
    readFileSync(
      join(import.meta.dir, "../../plugins/dotclaude/hooks/hooks.json"),
      "utf8",
    ),
  );
  expect(json.modules).toEqual(["./module/index.mjs"]);
  expect(Object.keys(json.hooks)).toEqual([
    "PreToolUse",
    "SessionStart",
    "SubagentStart",
  ]);
  for (const [event, [entry]] of Object.entries(json.hooks)) {
    const script = entry.hooks[0].args[0];
    expect(script).toStartWith(`\${CLAUDE_PLUGIN_ROOT}/hooks/`);
    const file = script.replace(
      "${CLAUDE_PLUGIN_ROOT}",
      join(import.meta.dir, "../../plugins/dotclaude"),
    );
    expect(existsSync(file), event).toBe(true);
  }
  expect(json.hooks.PreToolUse[0].matcher).toBe(
    "Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch|Read|Grep|Glob",
  );
  expect(typeof json.description).toBe("string");
});

test("a destructive Bash command gives an ask with its reason", async () => {
  const { $ } = engine();
  const { verdict } = await call(load(), $, {
    tool: "Bash",
    command: "git push --force",
  });
  expect(verdict.decision).toBe("ask");
  expect(verdict.reason).toContain("`git push --force`");
});

test("a Bash write to a project file is denied before it runs", async () => {
  const { $ } = engine();
  const { r, verdict } = await call(load(), $, {
    tool: "Bash",
    command: "sed -i '' 's/a/b/' src/a.c",
  });
  expect(r.deny).toContain("`Edit` or `Write`");
  expect(verdict).toBeUndefined();
  const off = await call(load({ guard_bash: false }), $, {
    tool: "Bash",
    command: "sed -i '' 's/a/b/' src/a.c",
  });
  expect(off.r.deny).toBeUndefined();
});

test("the auto-mode reminder gets the edit rule", async () => {
  const h = load();
  const e = {
    type: "auto_mode",
    text: "Do your work through the Bash tool wherever it can accomplish the job: make file changes with sed. Fall back to a dedicated tool only when Bash genuinely cannot do the job.",
  };
  const out = await h["prompt.attachment"]({}, e, async (x) => x);
  expect(out.text).toContain("`Edit` or `Write`");
  const kept = await load({ guard_bash: false })["prompt.attachment"](
    {},
    e,
    async (x) => x,
  );
  expect(kept).toBe(e);
});

test("a safe Bash command keeps the engine verdict", async () => {
  const { $ } = engine();
  const { verdict } = await call(load(), $, {
    tool: "Bash",
    command: "git status",
  });
  expect(verdict.decision).toBe("allow");
});

test("the ask does not outlive the call", async () => {
  const { $ } = engine();
  const h = load();
  await call(h, $, { tool: "Bash", command: "git reset --hard" });
  const after = await h["tool.check"]($, { tool_use_id: "t1" }, async () => ({
    decision: "allow",
  }));
  expect(after.decision).toBe("allow");
});

test("an edit of a settings file asks", async () => {
  const { $ } = engine();
  const { verdict } = await call(load(), $, {
    tool: "Edit",
    file_path: "/p/.claude/settings.json",
    old_string: "a",
    new_string: "b",
  });
  expect(verdict.decision).toBe("ask");
});

test("an option set to false turns a guard off", async () => {
  const { $ } = engine();
  const { verdict } = await call(load({ guard_bash: false }), $, {
    tool: "Bash",
    command: "git reset --hard",
  });
  expect(verdict.decision).toBe("allow");
});

test("a secret in a result is redacted and the model gets a note", async () => {
  const { $, calls } = engine({
    report: JSON.stringify([{ RuleID: "github-pat", Secret: SECRET }]),
  });
  const { r } = await call(
    load(),
    $,
    { tool: "Bash", command: "env" },
    { result: `TOKEN=${SECRET}` },
  );
  expect(r.result).toBe("TOKEN=[REDACTED:github-pat]");
  expect(r.context[0]).toContain("redacted 1 secret");
  expect(calls[0].argv[0]).toBe("betterleaks");
  expect(calls[0].init.stdin).toContain(SECRET);
});

test("a result passes unchanged when Betterleaks is missing", async () => {
  const { $ } = engine({ scanFails: true });
  const result = { result: `TOKEN=${SECRET}` };
  const { r } = await call(load(), $, { tool: "Bash", command: "env" }, result);
  expect(r).toBe(result);
});

test("a denied call and a failed call are not scanned", async () => {
  const { $, calls } = engine();
  const h = load();
  const denied = { deny: "no" };
  expect(await h["tool.call"]($, { tool: "Read" }, async () => denied)).toBe(
    denied,
  );
  const failed = { isError: true, result: "x" };
  expect(await h["tool.call"]($, { tool: "Read" }, async () => failed)).toBe(
    failed,
  );
  expect(calls).toHaveLength(0);
});

/** A fake `$` with these remotes, `gh` outputs, and user settings. */
function repo(remotes, settings = {}, { login = "me", orgs = "" } = {}) {
  const { $ } = engine();
  const out = (argv) => {
    if (argv[0] === "git") return remotes;
    return argv.includes("config") ? login : orgs;
  };
  $.process.run = async (argv) =>
    out(argv) === null
      ? { exitCode: 128, stdout: "" }
      : { exitCode: 0, stdout: out(argv) };
  $.fs.read = async (file) => {
    if (file === "/home/u/.claude/settings.json")
      return JSON.stringify(settings);
    throw new Error("missing");
  };
  return $;
}

const TRAILER =
  "git commit -m \"$(cat <<'EOF'\nFix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nEOF\n)\"";
const remote = (url) => `origin\t${url} (fetch)\norigin\t${url} (push)`;

test("a Claude trailer that the settings leave out is denied in a repository of the user", async () => {
  const $ = repo(remote("git@github.com:me/x.git"), {
    includeCoAuthoredBy: false,
  });
  const { verdict } = await call(load(), $, { tool: "Bash", command: TRAILER });
  expect(verdict.decision).toBe("deny");
  expect(verdict.reason).toContain("`Co-Authored-By`");
});

test("a Claude trailer that the settings keep passes in a repository of an owned organization", async () => {
  const $ = repo(remote("https://github.com/org/x"), {}, { orgs: "org\n" });
  const { verdict } = await call(load(), $, { tool: "Bash", command: TRAILER });
  expect(verdict).toEqual({ decision: "allow" });
});

test("a Claude attribution line asks in a repository of another owner", async () => {
  const $ = repo(remote("https://github.com/them/x"), {
    includeCoAuthoredBy: false,
  });
  const command =
    'git -C . commit -m "x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"';
  const { verdict } = await call(load(), $, { tool: "Bash", command });
  expect(verdict.decision).toBe("ask");
  expect(verdict.reason).toContain("AI policy");
});

test("a commit with no Claude line, a non-commit, and no repository keep the engine verdict", async () => {
  const them = repo(remote("https://github.com/them/x"));
  for (const command of ['git commit -m "Fix"', `echo ${TRAILER}`])
    expect(
      (await call(load(), them, { tool: "Bash", command })).verdict,
    ).toEqual({ decision: "allow" });
  const none = repo(null);
  expect(
    (await call(load(), none, { tool: "Bash", command: TRAILER })).verdict,
  ).toEqual({ decision: "allow" });
  expect(
    (
      await call(load({ guard_bash: false }), them, {
        tool: "Bash",
        command: TRAILER,
      })
    ).verdict,
  ).toEqual({ decision: "allow" });
});
