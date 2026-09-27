#!/usr/bin/env bun
// Run one Codex task from a brief file and write a report for the caller.
//
//   bun run-codex.mjs --brief <file> [--dir <dir>] [--model <model>] [--effort <level>]
//
// The codex-worker agent runs this in the background and hands back the report,
// so every step that used to be a separate agent turn (setup check, sandbox
// check, git state, the Codex run, collecting its result) is one command.
// Output files sit next to the brief: <stem>.result.md (Codex's last message),
// <stem>.log (Codex's output), and <stem>.report.md (what the caller reads,
// also printed to stdout). The Bash guard checks this command's --model like a
// `codex exec -p dotclaude-luna` command line.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { codexHome } from "../../../hooks/lib/_codex.mjs";

const PROFILE = "dotclaude-luna";
// Codex's workspace-write sandbox keeps .git, .agents, and .codex read-only,
// and no setting lifts it. Codex logs no fixed error text for this, so the
// report flags a denial Codex mentions next to one of those directories.
const SANDBOXED =
  /(denied|not permitted|read-only)[^\n]*\.(git|agents|codex)\/|\.(git|agents|codex)\/[^\n]*(denied|not permitted|read-only)/i;

function fail(code, message) {
  process.stderr.write(`run-codex: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--brief", "--dir", "--model", "--effort"].includes(key))
      fail(2, `unknown argument \`${key}\``);
    if (value === undefined) fail(2, `\`${key}\` needs a value`);
    opts[key.slice(2)] = value;
  }
  if (!opts.brief) fail(2, "`--brief <file>` is required");
  if (opts.model && !/^[\w.-]+$/.test(opts.model))
    fail(2, `invalid model \`${opts.model}\``);
  if (opts.effort && !/^[a-z]+$/.test(opts.effort))
    fail(2, `invalid effort \`${opts.effort}\``);
  return opts;
}

function git(dir, ...args) {
  const res = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return res.status === 0
    ? res.stdout.trimEnd()
    : `(git failed: ${res.stderr.trim()})`;
}

function block(text) {
  return `\`\`\`\n${text || "(empty)"}\n\`\`\``;
}

const opts = parseArgs(process.argv.slice(2));
const briefPath = path.resolve(opts.brief);
const dir = path.resolve(opts.dir ?? process.cwd());

if (!Bun.which("codex"))
  fail(
    3,
    "the Codex CLI is not on PATH; run `/dotclaude:setup-integrations codex`",
  );
if (!fs.existsSync(path.join(codexHome(), `${PROFILE}.config.toml`)))
  fail(
    3,
    `the \`${PROFILE}\` profile is missing; run \`/dotclaude:setup-integrations codex\``,
  );

let brief;
try {
  brief = fs.readFileSync(briefPath, "utf8");
} catch {
  fail(2, `cannot read the brief \`${briefPath}\``);
}
const stem = briefPath.replace(/\.md$/, "");
const resultFile = `${stem}.result.md`;
const logFile = `${stem}.log`;
const reportFile = `${stem}.report.md`;
// A report left by an earlier run of the same brief must not pass for this one.
for (const file of [resultFile, reportFile]) fs.rmSync(file, { force: true });

const startHead = git(dir, "rev-parse", "HEAD");
const startStatus = git(dir, "status", "--short");

const args = ["exec", "-p", PROFILE];
if (opts.model) args.push("-m", opts.model);
if (opts.effort) args.push("-c", `model_reasoning_effort="${opts.effort}"`);
args.push("-C", dir, "-o", resultFile, "-");
const prompt = `${brief.trimEnd()}\n\nWhen you finish, report the files you changed, the commands you ran with their exit codes, and what you could not verify.\n`;

const log = fs.openSync(logFile, "w");
const run = spawnSync("codex", args, {
  input: prompt,
  stdio: ["pipe", log, log],
});
fs.closeSync(log);
const status = run.status ?? `signal ${run.signal ?? "unknown"}`;

const logText = fs.readFileSync(logFile, "utf8");
const session = /^session id:\s*(\S+)/m.exec(logText)?.[1];
let result = "";
try {
  result = fs.readFileSync(resultFile, "utf8").trim();
} catch {
  // Codex writes the file only when it finishes a turn.
}

const lines = [
  `# Codex run: ${path.basename(stem)}`,
  "",
  `Exit status: ${status}${run.error ? ` (${run.error.message})` : ""}`,
  `Working directory: \`${dir}\``,
  `Session id: ${session ? `\`${session}\` (continue with \`codex exec resume ${session}\`)` : "not in the log"}`,
  `Log: \`${logFile}\``,
  "",
  "Codex made these changes outside Claude's edit tools. Review the diff and run the acceptance command before relying on them.",
  ...(SANDBOXED.test(`${result}\n${logText}`)
    ? [
        "",
        "Codex reports a write denied under `.git`, `.agents`, or `.codex`. Its sandbox keeps those read-only and no setting lifts it, so the caller must make those edits.",
      ]
    : []),
  "",
  "## Codex's report",
  "",
  result || "(Codex wrote no final message)",
  "",
  `## Git state (started at \`${startHead}\`)`,
  "",
  "Before:",
  block(startStatus),
  "After:",
  block(git(dir, "status", "--short")),
  "`git diff --stat`:",
  block(git(dir, "diff", "--stat")),
];
if (status !== 0)
  lines.push(
    "",
    "## Last 20 log lines",
    "",
    block(logText.trimEnd().split("\n").slice(-20).join("\n")),
  );

const report = `${lines.join("\n")}\n`;
fs.writeFileSync(reportFile, report);
process.stdout.write(`${report}\nReport file: ${reportFile}\n`);
process.exit(status === 0 ? 0 : 1);
