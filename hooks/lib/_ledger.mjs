// Per-session record of edits and check runs, used by the stop gate and the
// compaction carry-over. Stored under CLAUDE_PLUGIN_DATA, never in the repo.

import fs from "node:fs";
import path from "node:path";
import { git } from "./_bash-args.mjs";
import { expandHome, writeTargets } from "./_bash-writes.mjs";
import { stateDir } from "./_common.mjs";
import { parse } from "./_shell.mjs";
import { subagentTranscript } from "./_transcript.mjs";

/** Files that are not code: editing them alone needs no test run. */
export const NON_CODE =
  /\.(md|mdx|markdown|txt|rst|adoc|org|csv|tsv|svg|png|jpe?g|gif|webp|ico|pdf|log)$/i;

// Dotfiles and dot folders hold tool config (`.prettierrc`, `.github/`,
// `.vscode/`), which a local check seldom covers.
const DOT_CONFIG = /(^|\/)\./;

/**
 * True when a write to `rel` (relative to `root`) changes code that a check
 * must cover. Docs, dotfile config, and gitignored files (scratch files,
 * build output) do not count.
 */
export function codeFile(rel, root) {
  if (NON_CODE.test(rel) || DOT_CONFIG.test(rel)) return false;
  // `check-ignore -q` exits 0 only for an ignored path.
  return git(root, ["check-ignore", "-q", "--", rel]) === undefined;
}

function file(sessionId, agentId) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(
    stateDir(),
    `${safe(sessionId || "unknown")}${agentId ? `.${safe(agentId)}` : ""}.json`,
  );
}

export function load(sessionId, agentId) {
  try {
    return {
      seq: 0,
      lastEdit: null,
      lastCheck: null,
      blockedEdit: null,
      blockedCheck: null,
      prompts: [],
      ...JSON.parse(fs.readFileSync(file(sessionId, agentId), "utf8")),
    };
  } catch {
    return {
      seq: 0,
      lastEdit: null,
      lastCheck: null,
      blockedEdit: null,
      blockedCheck: null,
      prompts: [],
    };
  }
}

/** Paths edited by a session and all of its subagents. */
export function editedBySession(sessionId) {
  const prefix = file(sessionId, null).replace(/\.json$/, "");
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  const out = new Set();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (
      name !== `${base}.json` &&
      !(name.startsWith(`${base}.`) && name.endsWith(".json"))
    )
      continue;
    try {
      const state = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      for (const p of state.edited ?? []) out.add(p);
    } catch {
      // a ledger being rewritten; skip it
    }
  }
  return out;
}

export function save(sessionId, agentId, state) {
  const target = file(sessionId, agentId);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, target);
}

// Commands that test, build, lint or type-check. Matched against each simple
// command after wrappers are stripped.
const CHECK = [
  /^(pytest|py\.test|tox|nox|nose2|mypy|pyright|basedpyright|ruff check|ruff|pylint|flake8)\b/,
  /^python[0-9.]* -m (pytest|unittest|mypy|ruff|pyright|compileall|tox)\b/,
  /^(uv|poetry|pdm|hatch|rye) run (pytest|mypy|ruff|pyright|tox|python -m pytest)\b/,
  /^(npm|pnpm|yarn|bun) (run )?(test|build|lint|check|typecheck|type-check|tsc|verify|validate|ci|e2e|test:\S+|lint:\S+|build:\S+)\b/,
  /^(npm|pnpm|yarn) (t|tst)$/,
  /^bun test\b/,
  // Node's built-in runner. Flags only before `--test`: `node app.mjs --test` runs app.mjs.
  /^node (-\S+ )*--test( |$)/,
  /^(npx|pnpx|bunx|pnpm exec|yarn exec|pnpm dlx) (jest|vitest|tsc|eslint|biome|oxlint|playwright|mocha|ava|prettier --check|cypress run|markdownlint(?:-cli2)?)\b/,
  /^(jest|vitest|mocha|ava|tsc|eslint|biome|oxlint|playwright test|cypress run|markdownlint(?:-cli2)?)\b/,
  /^claude plugin validate\b/,
  /^cargo (test|build|check|clippy|nextest|fmt --check|fmt -- --check)\b/,
  /^go (test|build|vet)\b/,
  /^(golangci-lint|staticcheck) run\b/,
  // A task runner with no recipe, or with a recipe name that holds a check
  // word (`just skills skill-lint`, `make -C app test`, `make ci-local`).
  /^(make|gmake|just|task|mage)$/,
  /^(make|gmake|just|task|mage) (.* )?(\S*[^a-z ])?(test|tests|check|build|lint|all|ci|verify|validate)([^a-z ]\S*)?( |$)/,
  /^(xcrun (\S+ )*?)?(swift (build|test)|xcodebuild\b.*\b(build|test))\b/,
  /^(\.\/gradlew|gradle|\.\/mvnw|mvn) .*\b(test|build|check|verify|assemble|compile)\b/,
  /^dotnet (build|test)\b/,
  /^(ctest|ninja|meson test|cmake --build)\b/,
  /^bazel(isk)? (test|build)\b/,
  /^zig (build|test)\b/,
  /^(mix (test|compile)|rspec|bundle exec (rspec|rake)|rake (test|spec)|phpunit|vendor\/bin\/phpunit|composer test)\b/,
  /^deno (test|check|lint)\b/,
  /^(shellcheck|clang-tidy|swiftlint|ktlint|hadolint|actionlint)\b/,
  /^(flutter|dart) (test|analyze)\b/,
];

/**
 * The first simple command in `command` that is a check, without wrappers,
 * or undefined. Hook messages quote it, so a heredoc or a long pipeline
 * around the check does not show.
 */
export function checkCommand(command) {
  try {
    for (const cmd of parse(command).commands) {
      const joined = [cmd.name, ...cmd.args].join(" ");
      if (CHECK.some((re) => re.test(joined))) return joined;
    }
  } catch {
    // An unparsable command is not a check.
  }
  return undefined;
}

// Failure markers in the output of a command that exited 0, for example
// `pytest | tail` where the pipe hides the exit code.
const FAILURE_OUTPUT =
  /\b[1-9]\d* (failed|failing|errors?)\b|^FAILED\b|^FAIL\b|\bTests?: +[1-9]\d* failed|\bBUILD FAILED\b|npm ERR!|\berror\[E\d+\]|\berror TS\d+|^error: could not compile|\bpanicked at\b|^Traceback \(most recent call last\)|\b[1-9]\d* problems? \(/m;

export function outputShowsFailure(text) {
  return FAILURE_OUTPUT.test(text);
}

/**
 * Paths (relative to the project) of code files a Bash command writes, in
 * order, without duplicates. For inline interpreter code, the string-literal
 * path arguments of its write calls stand in for the targets. Relative targets
 * resolve against the directory an earlier `cd` in the command moved to.
 */
export function shellWrites(command, root, cwd = root) {
  const inProject = (target, base) => {
    if (!target || target.includes("$") || target.startsWith("/dev/"))
      return undefined;
    const abs = path.resolve(base, expandHome(target));
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    if (NON_CODE.test(rel) || rel.startsWith(".claude/")) return undefined;
    return rel;
  };
  let parsed;
  try {
    parsed = parse(command);
  } catch {
    return [];
  }
  const out = new Set();
  for (const cmd of parsed.commands) {
    // An unresolvable `cd $DIR` leaves the base at cwd, as the bash guard does.
    const base =
      cmd.cwdHint && !cmd.cwdHint.includes("$")
        ? path.resolve(cwd, expandHome(cmd.cwdHint))
        : cwd;
    // Scratch files outside the project, such as in /tmp, are not edits.
    for (const { target } of writeTargets(cmd, base)) {
      const rel = inProject(target, base);
      if (rel) out.add(rel);
    }
  }
  return [...out];
}

// A plain `cat` of named files, with no pipe, redirect, glob, or expansion:
// the whole of each file goes into the context.
const CAT =
  /^\s*cat((?:\s+(?:'[^'\n]*'|"[^"$`\\\n]*"|[^\s'"|;&<>$`()\\*?[\]{}]+))+)\s*$/;
const MAX_READS = 500;

/** Absolute paths that a plain `cat` command reads in full, or []. */
export function fullReads(command, cwd) {
  const m = CAT.exec(command ?? "");
  if (!m) return [];
  const words = m[1].match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  return words
    .map((w) => w.replace(/^(['"])(.*)\1$/, "$2"))
    .filter((w) => !w.startsWith("-"))
    .map((w) => path.resolve(cwd, expandHome(w)));
}

/** Size and mtime of a file, or null when it cannot be read. */
export function readStamp(abs) {
  try {
    const st = fs.statSync(abs);
    return st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
  } catch {
    return null;
  }
}

/** Record a full read of `abs` by `how` (the command or tool) in `state`. */
export function recordRead(state, abs, how) {
  const stamp = readStamp(abs);
  if (!stamp) return;
  const reads = state.reads ?? {};
  delete reads[abs];
  reads[abs] = { ...stamp, how };
  const keys = Object.keys(reads);
  for (const k of keys.slice(0, -MAX_READS)) delete reads[k];
  state.reads = reads;
}

// Running subagents: one marker file per agent, written on `SubagentStart`
// and removed on `SubagentStop`. A file per agent makes each change atomic,
// so agents that start or stop at the same time do not lose an update.
const RUNNING = ".running";
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");

/** Record a started subagent, with the transcript that shows its activity. */
export function agentStarted(sessionId, agentId, transcriptPath) {
  // The transcript layout is not documented, so a missing file falls back
  // to the marker's own time.
  const transcript = transcriptPath
    ? subagentTranscript(transcriptPath, sessionId, agentId)
    : "";
  fs.writeFileSync(
    path.join(stateDir(), `${safeId(sessionId)}.${safeId(agentId)}${RUNNING}`),
    transcript,
  );
}

export function agentStopped(sessionId, agentId) {
  fs.rmSync(
    path.join(stateDir(), `${safeId(sessionId)}.${safeId(agentId)}${RUNNING}`),
    { force: true },
  );
}

/** Subagents of a session that started, did not stop, and are not idle. */
export function runningAgents(sessionId, idleMs, now = Date.now()) {
  const dir = stateDir();
  const prefix = `${safeId(sessionId)}.`;
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(RUNNING)) continue;
    try {
      const marker = path.join(dir, name);
      let last = fs.statSync(marker).mtimeMs;
      const transcript = fs.readFileSync(marker, "utf8");
      if (transcript && fs.existsSync(transcript))
        last = Math.max(last, fs.statSync(transcript).mtimeMs);
      if (now - last < idleMs) count += 1;
    } catch {
      // The agent stopped while this loop ran.
    }
  }
  return count;
}
