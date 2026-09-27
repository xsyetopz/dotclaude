// run-codex.mjs against a fake `codex` on PATH and a temporary git repository.

import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../skills/codex-fanout/scripts/run-codex.mjs",
);

// Records its arguments and stdin, edits a.txt in -C's directory, writes -o.
const FAKE_CODEX = `#!/bin/sh
out=""; dir=""; prev=""
for a in "$@"; do
  [ "$prev" = "-o" ] && out="$a"
  [ "$prev" = "-C" ] && dir="$a"
  prev="$a"
done
printf '%s\\n' "$@" > "$FAKE_ARGS"
cat > "$FAKE_STDIN"
ls "$(dirname "$out")" | grep -c "report.md" > "$FAKE_SEEN"
echo "session id: 0000-fake"
echo edited >> "$dir/a.txt"
[ -n "$FAKE_FAIL" ] && { echo "boom"; exit 7; }
echo "\${FAKE_RESULT:-Changed a.txt.}" > "$out"
`;

function setup({ profile = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "run-codex-"));
  const bin = path.join(base, "bin");
  const home = path.join(base, "codex-home");
  const repo = path.join(base, "repo");
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(bin, "codex"), FAKE_CODEX, { mode: 0o755 });
  if (profile)
    fs.writeFileSync(path.join(home, "dotclaude-luna.config.toml"), "");
  execFileSync("git", ["-C", repo, "init", "-q"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "start\n");
  execFileSync("git", ["-C", repo, "add", "a.txt"]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-qm",
    "init",
  ]);
  const brief = path.join(base, "codex-brief-x.md");
  fs.writeFileSync(brief, "Append a line to a.txt.\nAcceptance: `cat a.txt`\n");
  const run = (extra = [], env = {}) =>
    spawnSync("bun", [SCRIPT, "--brief", brief, "--dir", repo, ...extra], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CODEX_HOME: home,
        FAKE_ARGS: path.join(base, "args.txt"),
        FAKE_STDIN: path.join(base, "stdin.txt"),
        FAKE_SEEN: path.join(base, "seen.txt"),
        ...env,
      },
    });
  return { base, brief, repo, run };
}

test("runs Codex on the brief and reports its result and the git state", () => {
  const { base, run } = setup();
  const res = run(["--model", "gpt-6-sol", "--effort", "max"]);
  expect(res.status, res.stderr).toBe(0);
  const args = fs.readFileSync(path.join(base, "args.txt"), "utf8").split("\n");
  expect(args.slice(0, 7)).toEqual([
    "exec",
    "-p",
    "dotclaude-luna",
    "-m",
    "gpt-6-sol",
    "-c",
    'model_reasoning_effort="max"',
  ]);
  expect(fs.readFileSync(path.join(base, "stdin.txt"), "utf8")).toMatch(
    /^Append a line to a\.txt\.[\s\S]*report the files you changed/,
  );
  const report = fs.readFileSync(
    path.join(base, "codex-brief-x.report.md"),
    "utf8",
  );
  expect(res.stdout).toContain(report);
  expect(report).toMatch(/Exit status: 0/);
  expect(report).toMatch(/Session id: `0000-fake`/);
  expect(report).toMatch(/Changed a\.txt\./);
  expect(report).toMatch(/After:\n```\n M a\.txt/);
  expect(report).toMatch(/a\.txt \| 1 \+/);
  expect(report).not.toMatch(/Last 20 log lines/);
});

test("a failed run exits 1 and includes the log tail", () => {
  const { run } = setup();
  const res = run([], { FAKE_FAIL: "1" });
  expect(res.status).toBe(1);
  expect(res.stdout).toMatch(/Exit status: 7/);
  expect(res.stdout).toMatch(/Codex wrote no final message/);
  expect(res.stdout).toMatch(/## Last 20 log lines[\s\S]*boom/);
});

test("a brief that only mentions .agents runs; a reported denial there is flagged", () => {
  const { brief, run } = setup();
  fs.writeFileSync(
    brief,
    "Fix a.txt. Another worker edits `.agents/`; do not touch it.\n",
  );
  const ok = run();
  expect(ok.status, ok.stderr).toBe(0);
  expect(ok.stdout).not.toMatch(/write denied under/);
  const denied = run([], {
    FAKE_RESULT:
      "workspace permissions denied writing `.agents/skills/x/SKILL.md`",
  });
  expect(denied.stdout).toMatch(/write denied under `\.git`, `\.agents`/);
});

test("an earlier report is gone while a rerun of the same brief works", () => {
  const { base, run } = setup();
  expect(run().status).toBe(0);
  expect(fs.existsSync(path.join(base, "codex-brief-x.report.md"))).toBe(true);
  expect(run([], { FAKE_FAIL: "1" }).status).toBe(1);
  expect(fs.readFileSync(path.join(base, "seen.txt"), "utf8").trim()).toBe("0");
});

test("stops before Codex when the profile is missing or arguments are wrong", () => {
  const { base, run } = setup({ profile: false });
  const res = run();
  expect(res.status).toBe(3);
  expect(res.stderr).toMatch(/setup-integrations codex/);
  expect(run(["--dangerously-bypass-approvals-and-sandbox", "x"]).status).toBe(
    2,
  );
  expect(run(["--effort", 'max" -c x="y']).status).toBe(2);
  expect(fs.existsSync(path.join(base, "args.txt"))).toBe(false);
});
