// Stop verification gate and the edit/check ledger it reads.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  checkRun,
  data,
  edit,
  HOOKS,
  hook,
  repo,
  session,
  stop,
} from "../support/hooks.mjs";

test("stop gate blocks once after an unverified edit", () => {
  const sid = session();
  edit(sid);
  const first = stop(sid);
  expect(first.decision).toBe("block");
  expect(first.reason).toMatch(/src\/app\.js/);
  expect(stop(sid), "same edit state does not block twice").toBe(null);
});

test("stop gate counts files written through Bash as edits", () => {
  const sid = session();
  checkRun(sid, "bun test");
  checkRun(sid, "cat > src/gen.js <<'EOF'\nexport const x = 1;\nEOF");
  const out = stop(sid);
  expect(out?.decision).toBe("block");
  expect(out.reason).toMatch(/src\/gen\.js/);
  const sid2 = session();
  checkRun(sid2, "sed -n 1,5p src/gen.js > /tmp/view.txt && bun test");
  expect(stop(sid2), "a write outside the project is not an edit").toBe(null);
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
    stop(sid, "Done.", { hook_event_name: "SubagentStop", agent_id: "a2" })
      ?.decision,
  ).toBe("block");
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
  expect(out?.decision).toBe("block");
  expect(out.reason).toMatch(/src\/worker\.js/);
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

test("stop gate accepts a reply that says the change is unverified", () => {
  const sid = session();
  edit(sid);
  expect(
    stop(
      sid,
      "Changed the parser. I haven't run the tests; there is no test runner configured.",
    ),
  ).toBe(null);
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
  expect(out.decision).toBe("block");
  expect(out.reason).toMatch(/pytest/);
});

test("a piped check whose output shows failures counts as failed", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "pytest -q | tail -5", true, "3 passed, 2 failed in 0.4s");
  expect(stop(sid, "Tests pass.").decision).toBe("block");
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

test("stop gate flags a pass claim when nothing ran", () => {
  const sid = session();
  expect(stop(sid, "All tests pass.").decision).toBe("block");
});

test("plugin validation and markdownlint count as check runs", () => {
  for (const command of [
    "bun run validate",
    "claude plugin validate --strict .",
    "bunx markdownlint-cli2 --config markdownlint-cli2.jsonc README.md",
    "markdownlint-cli2 '**/*.md'",
  ]) {
    const sid = session();
    edit(sid);
    checkRun(sid, command);
    expect(stop(sid), command).toBe(null);
  }
});

test("stop gate is not bypassed by a reply that mentions an error or failure it fixed", () => {
  for (const message of [
    "Fixed the parser error; empty input now returns [].",
    "Fixed the failing branch in parse().",
  ]) {
    const sid = session();
    edit(sid);
    expect(stop(sid, message)?.decision, message).toBe("block");
  }
});

// TaskCompleted blocks with exit code 2 and a reason on stderr.
function completeTask(input) {
  const res = spawnSync(
    "bun",
    [path.join(HOOKS, "task-completed/require-check.mjs")],
    {
      input: JSON.stringify({
        cwd: repo,
        hook_event_name: "TaskCompleted",
        task_id: "1",
        task_name: "Fix the parser",
        task_status: "completed",
        ...input,
      }),
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PLUGIN_DATA: data,
        CLAUDE_PROJECT_DIR: repo,
      },
    },
  );
  return { code: res.status, stderr: res.stderr };
}

test("a task completion after an unchecked edit is blocked once", () => {
  const sid = session();
  edit(sid);
  const first = completeTask({ session_id: sid });
  expect(first.code).toBe(2);
  expect(first.stderr).toMatch(/src\/app\.js/);
  expect(completeTask({ session_id: sid }).code, "blocks once").toBe(0);
});

test("a task completion passes after a check, with no edit, or without fields", () => {
  const sid = session();
  edit(sid);
  checkRun(sid, "bun test");
  expect(completeTask({ session_id: sid }).code).toBe(0);
  expect(completeTask({ session_id: session() }).code).toBe(0);
  expect(completeTask({}).code).toBe(0);
  const sid2 = session();
  edit(sid2);
  expect(
    completeTask({ session_id: sid2, task_status: "in_progress" }).code,
  ).toBe(0);
});

test("each task completion logs its input field names", () => {
  const sid = session();
  completeTask({ session_id: sid, transcript_path: "/t.jsonl" });
  const entry = fs
    .readFileSync(path.join(data, "verdicts.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .findLast((e) => e.session === sid);
  expect(entry.level).toBe("task");
  expect(entry.fields).toContain("transcript_path");
  expect(entry.fields).toContain("task_name");
});
