// Stop verification gate and the edit/check ledger it reads.

import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  blocked,
  checkRun,
  data,
  edit,
  feedback,
  HOOKS,
  hook,
  repo,
  session,
  stop,
  tmp,
} from "../support/hooks.mjs";

test("stop gate blocks once after an unverified edit", () => {
  const sid = session();
  edit(sid);
  const first = stop(sid);
  expect(blocked(first)).toBe("Stop");
  expect(feedback(first)).toMatch(/src\/app\.js/);
  // Claude Code can show a Stop reason twice (anthropics/claude-code#96909).
  expect(feedback(first).length, "a short reason").toBeLessThan(300);
  expect(stop(sid), "same edit state does not block twice").toBe(null);
});

test("dotfile config edits are not code edits", () => {
  for (const file of [
    ".prettierrc",
    ".github/workflows/ci.yml",
    ".vscode/settings.json",
  ]) {
    const sid = session();
    checkRun(sid, "bun test");
    edit(sid, file);
    expect(stop(sid), file).toBe(null);
  }
});

test("stop gate counts files written through Bash as edits", () => {
  const sid = session();
  checkRun(sid, "bun test");
  checkRun(sid, "cat > src/gen.js <<'EOF'\nexport const x = 1;\nEOF");
  const out = stop(sid);
  expect(blocked(out)).toBe("Stop");
  expect(feedback(out)).toMatch(/src\/gen\.js/);
  const sid2 = session();
  checkRun(sid2, "sed -n 1,5p src/gen.js > /tmp/view.txt && bun test");
  expect(stop(sid2), "a write outside the project is not an edit").toBe(null);
});

test("git config and gitignored files are not code edits", () => {
  fs.appendFileSync(path.join(repo, ".git", "info", "exclude"), "scratch/\n");
  for (const command of [
    "echo 'dist/' >> .gitignore",
    "echo 'x' >> .git/info/exclude",
    "mkdir -p scratch && echo 'print(1)' > scratch/probe.py",
  ]) {
    const sid = session();
    checkRun(sid, "bun test");
    checkRun(sid, command);
    expect(stop(sid), command).toBe(null);
  }
  const sid = session();
  checkRun(sid, "bun test");
  edit(sid, "scratch/probe.py");
  expect(stop(sid), "an Edit of an ignored file").toBe(null);
});

test("inline scripts that write only scratch files are not edits", () => {
  const sid = session();
  const bash = (command) =>
    hook("post-tool-use/record-edits-and-checks.mjs", {
      session_id: sid,
      agent_id: "a2",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command },
      tool_response: { stdout: "", stderr: "" },
    });
  bash(
    "python3 - <<'EOF'\nimport json\njson.dump({}, open('/tmp/dotclaude-scratch/dec.json', 'w'))\nEOF",
  );
  expect(
    stop(sid, "Done.", { hook_event_name: "SubagentStop", agent_id: "a2" }),
  ).toBe(null);
  bash("python3 - <<'EOF'\nopen('src/app.py', 'w').write('x = 2')\nEOF");
  expect(
    blocked(
      stop(sid, "Done.", { hook_event_name: "SubagentStop", agent_id: "a2" }),
    ),
  ).toBe("SubagentStop");
});

test("inline scripts record only the path arguments of their write calls", () => {
  const edited = (command) => {
    const sid = session();
    checkRun(sid, command);
    try {
      return JSON.parse(
        fs.readFileSync(path.join(data, "sessions", `${sid}.json`), "utf8"),
      ).edited;
    } catch {
      return undefined;
    }
  };
  const none = (value) =>
    expect(!value?.length, JSON.stringify(value)).toBeTruthy();
  none(
    edited(
      `python3 -c "import re; s = open('in.html').read(); t = re.sub(r'<script.*?</script>|<style.*?</style>', '', s); open('x.txt','w').write(t)"`,
    ),
  );
  none(
    edited(
      `python3 -c "s = open('src/in.py').read(); open('/tmp/dotclaude-out.txt', 'w').write(s)"`,
    ),
  );
  none(edited(`cd /tmp/x && python3 -c "open('src/app.py','w')"`));
  expect(edited(`python3 -c "open('src/app.py','w')"`)).toStrictEqual([
    "src/app.py",
  ]);
  expect(
    edited(`node -e "require('fs').writeFileSync('src/gen.js', '')"`),
  ).toStrictEqual(["src/gen.js"]);
  // A path held in a variable set from a literal, and a raw-string literal.
  expect(
    edited(`python3 -c "p = 'src/var.py'; open(p, 'w').write('1')"`),
  ).toStrictEqual(["src/var.py"]);
  expect(edited(`python3 -c "open(r'src/raw.py', 'w')"`)).toStrictEqual([
    "src/raw.py",
  ]);
  // A variable that holds a `Path` of a literal, then writes through it.
  expect(
    edited(
      `python3 - <<'EOF'\nimport pathlib\np=pathlib.Path("src/Conc.cs"); s=p.read_text()\np.write_text(s)\nEOF`,
    ),
  ).toStrictEqual(["src/Conc.cs"]);
  expect(
    edited(`python3 -c "f = Path('src/b.py'); f.write_bytes(b'')"`),
  ).toStrictEqual(["src/b.py"]);
  none(edited(`python3 -c "d = Path('src') / 'x.py'; d.write_text('')"`));
  none(edited(`python3 -c "p = Path('src/r.py'); print(p.read_text())"`));
  none(edited(`python3 -c "p = 'src/read.py'; print(open(p).read())"`));
  none(edited(`python3 -c "open(f'src/{n}.py', 'w')"`));
});

test("the stop reason quotes only the check, not the script around it", () => {
  const sid = session();
  checkRun(
    sid,
    "cd /tmp && ruff check src/app.py && python3 - <<'EOF'\nprint(`x`)\nEOF",
  );
  edit(sid);
  const shown = /last check: `([^`]*)`/.exec(feedback(stop(sid)) ?? "")?.[1];
  expect(shown).toBe("ruff check src/app.py");
});

test("subagent stop checks the subagent's own ledger", () => {
  const sid = session();
  hook("post-tool-use/record-edits-and-checks.mjs", {
    session_id: sid,
    agent_id: "a1",
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: path.join(repo, "src/worker.js") },
  });
  expect(stop(sid), "the main session made no edit").toBe(null);
  const out = stop(sid, "Done.", {
    hook_event_name: "SubagentStop",
    agent_id: "a1",
  });
  expect(blocked(out)).toBe("SubagentStop");
  expect(feedback(out)).toMatch(/src\/worker\.js/);
});

test("a long check command in the stop reason shows that it was cut", () => {
  const sid = session();
  const command = `bun test ${Array.from({ length: 30 }, (_, i) => `tests/unit/case-${i}.test.mjs`).join(" ")}`;
  checkRun(sid, command);
  edit(sid);
  const out = stop(sid);
  expect(blocked(out)).toBe("Stop");
  const shown = /last check: `([^`]*)`/.exec(feedback(out))?.[1];
  expect(shown?.endsWith("…"), feedback(out)).toBe(true);
  expect(command.startsWith(shown.slice(0, -1))).toBe(true);
});

test("a multi-file sd records every file as this session's edit", () => {
  const sid = session();
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  for (const f of ["a.js", "b.js", "c.js"])
    fs.writeFileSync(path.join(repo, "src", f), "old\n");
  checkRun(sid, "sd old new src/a.js src/b.js src/c.js");
  const ledger = JSON.parse(
    fs.readFileSync(path.join(data, "sessions", `${sid}.json`), "utf8"),
  );
  expect(ledger.edited).toStrictEqual(["src/a.js", "src/b.js", "src/c.js"]);
});

test("stop gate passes after a passing check", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "bun test");
  expect(stop(sid)).toBe(null);
});

test("a failed check with no edit is not blocked", () => {
  // A read-only agent such as `test-runner` reports failures that it ran.
  const sid = session();
  checkRun(sid, "pytest", false);
  expect(stop(sid, "3 tests fail.")).toBe(null);
});

test("stop gate honors stop_hook_active and running background work", () => {
  const sid = session();
  edit(sid);
  expect(stop(sid, "Done.", { stop_hook_active: true })).toBe(null);
  expect(
    stop(sid, "Done.", {
      background_tasks: [{ id: "t", type: "shell", status: "running" }],
    }),
  ).toBe(null);
});

test("stop gate catches a failed check reported as passing", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "pytest", false);
  const out = stop(sid, "All tests pass now.");
  expect(blocked(out)).toBe("Stop");
  expect(feedback(out)).toMatch(/pytest/);
});

test("a failed last check blocks once in any language of the reply", () => {
  // The gate reads the ledger, not the reply, because a reply can be in any
  // language.
  const sid = session();
  edit(sid);
  checkRun(sid, "pytest", false);
  const out = stop(sid, "Wszystkie testy przechodzą.");
  expect(blocked(out)).toBe("Stop");
  expect(feedback(out)).toMatch(/pytest/);
  expect(stop(sid, "Testy nie przechodzą."), "blocks once").toBe(null);
});

test("a piped check whose output shows failures counts as failed", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "pytest -q | tail -5", true, "3 passed, 2 failed in 0.4s");
  expect(blocked(stop(sid, "Tests pass."))).toBe("Stop");
});

test("zero failures in output counts as passing", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "pytest -q | tail -5", true, "5 passed, 0 failed in 0.4s");
  expect(stop(sid, "Tests pass.")).toBe(null);
});

test("doc edits do not trip the stop gate", () => {
  const sid = session();
  edit(sid, "README.md");
  expect(stop(sid)).toBe(null);
});

test("a pass claim with no edit and no check is not blocked", () => {
  // A read-only agent that reports what it read is not claiming its own work.
  const sid = session();
  expect(stop(sid, "All tests pass.")).toBe(null);
});

test("plugin validation counts as a check run", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "bun run validate");
  expect(stop(sid)).toBe(null);
});

test("a lint run alone does not satisfy the gate in a project with tests", () => {
  for (const command of [
    "claude plugin validate --strict .",
    "bunx markdownlint-cli2 --config markdownlint-cli2.jsonc README.md",
    "markdownlint-cli2 '**/*.md'",
    "bunx eslint src",
    "just lint",
  ]) {
    const sid = session();
    edit(sid, "src/app.mjs");
    checkRun(sid, command);
    const out = stop(sid);
    expect(blocked(out), command).toBe("Stop");
    expect(feedback(out), command).toMatch(/does not run the code/);
    expect(feedback(out), "names the test command").toMatch(/`just test`/);
    expect(stop(sid), "blocks once").toBe(null);
  }
});

test("the static-check reason stays short for long names", () => {
  const sid = session();
  edit(sid, `src/${"deep/".repeat(12)}application-module.mjs`);
  checkRun(sid, `bunx eslint ${"--rule x ".repeat(20)}src`);
  const out = stop(sid);
  expect(blocked(out)).toBe("Stop");
  expect(feedback(out).length, "a short reason").toBeLessThan(300);
  expect(feedback(out)).toMatch(/`just test`/);
});

test("a failed run check is not hidden by a later lint run", () => {
  const sid = session();
  edit(sid, "src/app.mjs");
  checkRun(sid, "bun test", false);
  checkRun(sid, "bunx eslint src");
  const out = stop(sid);
  expect(blocked(out)).toBe("Stop");
  expect(feedback(out)).toMatch(/`bun test`.*failed/);
  // A passing run clears the failure.
  const sid2 = session();
  edit(sid2, "src/app.mjs");
  checkRun(sid2, "bun test", false);
  checkRun(sid2, "bun test");
  expect(stop(sid2)).toBe(null);
});

/** A project with no `justfile` and a test command that only its instructions name. */
function namedProject() {
  const dir = fs.realpathSync(tmp("dotclaude-named-"));
  execFileSync("git", ["init", "-q", dir]);
  fs.writeFileSync(
    path.join(dir, "CLAUDE.md"),
    "Run `uv run python manage.py test` before you finish.\n",
  );
  const env = { CLAUDE_PROJECT_DIR: dir };
  const record = (sid, tool_name, tool_input) =>
    hook(
      "post-tool-use/record-edits-and-checks.mjs",
      {
        session_id: sid,
        hook_event_name: "PostToolUse",
        tool_name,
        tool_input,
        tool_response: { stdout: "", stderr: "" },
        cwd: dir,
      },
      env,
    );
  return { dir, env, record };
}

test("a project-named test command counts after a lint run that follows an edit", () => {
  const { dir, env, record } = namedProject();
  const sid = session();
  record(sid, "Edit", { file_path: path.join(dir, "app.py") });
  record(sid, "Bash", { command: "ruff check ." });
  record(sid, "Bash", { command: "uv run python manage.py test" });
  const input = {
    session_id: sid,
    hook_event_name: "Stop",
    stop_hook_active: false,
    cwd: dir,
  };
  expect(hook("stop/require-verification.mjs", input, env)).toBe(null);
  fs.rmSync(dir, { recursive: true });
});

test("a task completion after only a lint run is blocked once", () => {
  const sid = session();
  edit(sid, "src/app.mjs");
  checkRun(sid, "bunx eslint src");
  const first = completeTask({ session_id: sid });
  expect(first.code).toBe(2);
  expect(first.stderr).toBe(
    '[dotclaude] The last check (`bunx eslint src`) does not run the code, so the task #1 "Fix the parser" is not verified. Run `just test`. Then mark the task completed. If no check can run, mark the task completed again, and say in your reply that the change is unverified.\n',
  );
  expect(first.stderr.length, "a short reason").toBeLessThan(300);
  expect(completeTask({ session_id: sid }).code, "blocks once").toBe(0);
  const sid2 = session();
  edit(sid2, "src/app.mjs");
  checkRun(sid2, "bunx eslint src");
  checkRun(sid2, "bun test");
  expect(completeTask({ session_id: sid2 }).code).toBe(0);
});

test("a run check satisfies the gate, also before or after a lint run", () => {
  for (const commands of [
    ["bun test"],
    ["bunx eslint src", "bun test"],
    ["bun test", "bunx eslint src"],
    ["just test"],
    ["tsc --noEmit"],
  ]) {
    const sid = session();
    edit(sid, "src/app.mjs");
    for (const command of commands) checkRun(sid, command);
    expect(stop(sid), commands.join(" then ")).toBe(null);
  }
});

test("a run check before the edit does not cover a lint run after it", () => {
  const sid = session();
  checkRun(sid, "bun test");
  edit(sid, "src/app.mjs");
  checkRun(sid, "bunx eslint src");
  expect(blocked(stop(sid))).toBe("Stop");
});

test("a lint run and a test run in one command count as a run check", () => {
  const sid = session();
  edit(sid, "src/app.mjs");
  checkRun(sid, "bunx eslint src && bun test");
  expect(stop(sid)).toBe(null);
});

test("a ledger check with no kind counts as a run check", () => {
  const sid = session();
  edit(sid, "src/app.mjs");
  checkRun(sid, "bun test");
  const file = fs
    .readdirSync(data, { recursive: true })
    .find((f) => String(f).includes(sid));
  const ledger = path.join(data, String(file));
  const state = JSON.parse(fs.readFileSync(ledger, "utf8"));
  delete state.lastCheck.kind;
  delete state.lastRunSeq;
  fs.writeFileSync(ledger, JSON.stringify(state));
  expect(stop(sid)).toBe(null);
});

test("a lint run satisfies the gate in a project with no test command", () => {
  const bare = fs.realpathSync(tmp("dotclaude-lint-"));
  execFileSync("git", ["init", "-q", bare]);
  const env = { CLAUDE_PROJECT_DIR: bare };
  const sid = session();
  hook(
    "post-tool-use/record-edits-and-checks.mjs",
    {
      session_id: sid,
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: path.join(bare, "src/app.mjs") },
      cwd: bare,
    },
    env,
  );
  hook(
    "post-tool-use/record-edits-and-checks.mjs",
    {
      session_id: sid,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "bunx eslint src" },
      tool_response: { stdout: "", stderr: "" },
      cwd: bare,
    },
    env,
  );
  const input = {
    session_id: sid,
    hook_event_name: "Stop",
    stop_hook_active: false,
    cwd: bare,
  };
  expect(hook("stop/require-verification.mjs", input, env)).toBe(null);
  // The same ledger blocks once the project names a test command.
  fs.writeFileSync(
    path.join(bare, "package.json"),
    '{"scripts":{"test":"bun test"}}',
  );
  expect(blocked(hook("stop/require-verification.mjs", input, env))).toBe(
    "Stop",
  );
  fs.rmSync(bare, { recursive: true });
});

test("a docs edit with a lint run passes", () => {
  const sid = session();
  edit(sid, "README.md");
  checkRun(sid, "markdownlint-cli2 README.md");
  expect(stop(sid)).toBe(null);
});

test("a reply that says the change is not verified still blocks once", () => {
  const sid = session();
  edit(sid);
  expect(blocked(stop(sid, "I haven't run the tests."))).toBe("Stop");
  expect(stop(sid, "I haven't run the tests.")).toBe(null);
});

// TaskCompleted blocks with exit code 2 and a reason on stderr.
function completeTask(input, env = {}) {
  const res = spawnSync(
    "bun",
    [path.join(HOOKS, "task-completed/require-check.mjs")],
    {
      input: JSON.stringify({
        cwd: repo,
        hook_event_name: "TaskCompleted",
        task_id: "1",
        task_subject: "Fix the parser",
        ...input,
      }),
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PLUGIN_DATA: data,
        CLAUDE_PROJECT_DIR: repo,
        ...env,
      },
    },
  );
  return { code: res.status, stderr: res.stderr };
}

test("an edit with no check passes when the project names no test command", () => {
  // Claude cannot run a check there, so a block would only add a turn.
  const bare = tmp("dotclaude-bare-");
  const env = { CLAUDE_PROJECT_DIR: bare };
  const sid = session();
  edit(sid);
  const input = {
    session_id: sid,
    hook_event_name: "Stop",
    stop_hook_active: false,
    cwd: bare,
  };
  expect(hook("stop/require-verification.mjs", input, env)).toBe(null);
  expect(completeTask({ session_id: sid, cwd: bare }, env).code).toBe(0);
  // A Makefile with no test target does not show tests.
  fs.writeFileSync(path.join(bare, "Makefile"), "build:\n\tcc a.c\n");
  edit(sid, "src/b.js");
  expect(hook("stop/require-verification.mjs", input, env)).toBe(null);
  fs.rmSync(bare, { recursive: true });
});

test("a build file that shows tests turns the gate on", () => {
  // A pyproject.toml shows a Python project, though not its test command.
  const dir = tmp("dotclaude-py-");
  fs.writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = 'x'\n");
  const sid = session();
  edit(sid);
  const out = hook(
    "stop/require-verification.mjs",
    {
      session_id: sid,
      hook_event_name: "Stop",
      stop_hook_active: false,
      cwd: dir,
    },
    { CLAUDE_PROJECT_DIR: dir },
  );
  expect(blocked(out)).toBe("Stop");
  fs.rmSync(dir, { recursive: true });
});

test("a task completion after an unchecked edit is blocked once", () => {
  const sid = session();
  edit(sid);
  const first = completeTask({ session_id: sid });
  expect(first.code).toBe(2);
  expect(first.stderr).toMatch(/src\/app\.js/);
  expect(first.stderr).toContain('#1 "Fix the parser"');
  expect(completeTask({ session_id: sid }).code, "blocks once").toBe(0);
});

test("a task completion passes after a check, with no edit, or without fields", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "bun test");
  expect(completeTask({ session_id: sid }).code).toBe(0);
  expect(completeTask({ session_id: session() }).code).toBe(0);
  expect(completeTask({}).code).toBe(0);
});
