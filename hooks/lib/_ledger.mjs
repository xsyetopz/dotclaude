// Per-session record of edits and check runs, used by the stop gate and the
// compaction carry-over. Stored under CLAUDE_PLUGIN_DATA, never in the repo.

// Only `shellWrites` uses `node:path`, for `writeTargets`. Slice s12 removes it.
import nodePath from "node:path";
import { git } from "./_bash-args.mjs";
import { expandHome, writeTargets } from "./_bash-writes.mjs";
import { stateDir } from "./_core.mjs";
import { pathFor } from "./_path.mjs";
import { parse } from "./_shell.mjs";

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

function file(io, sessionId, agentId) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  return pathFor(io.platform).join(
    stateDir(io),
    `${safe(sessionId || "unknown")}${agentId ? `.${safe(agentId)}` : ""}.json`,
  );
}

export async function load(io, sessionId, agentId) {
  try {
    return {
      seq: 0,
      lastEdit: null,
      lastCheck: null,
      blockedEdit: null,
      blockedCheck: null,
      prompts: [],
      ...JSON.parse(await io.fs.read(file(io, sessionId, agentId))),
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
export async function editedBySession(io, sessionId) {
  const path = pathFor(io.platform);
  const prefix = file(io, sessionId, null).replace(/\.json$/, "");
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  const out = new Set();
  let names = [];
  try {
    names = (await io.fs.list(dir)).map((e) => e.name);
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
      const state = JSON.parse(await io.fs.read(path.join(dir, name)));
      for (const p of state.edited ?? []) out.add(p);
    } catch {
      // a ledger being rewritten; skip it
    }
  }
  return out;
}

export async function save(io, sessionId, agentId, state) {
  await io.fs.write(file(io, sessionId, agentId), JSON.stringify(state));
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
 * `home` is the folder that `~` expands to.
 */
export function shellWrites(command, root, cwd, home) {
  const path = nodePath;
  const inProject = (target, base) => {
    if (!target || target.includes("$") || target.startsWith("/dev/"))
      return undefined;
    const abs = path.resolve(base, expandHome(target, home));
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
        ? path.resolve(cwd, expandHome(cmd.cwdHint, home))
        : cwd;
    // Scratch files outside the project, such as in /tmp, are not edits.
    for (const { target } of writeTargets(cmd, base, home, path)) {
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

/**
 * Absolute paths that a plain `cat` command reads in full, or []. `home` is
 * the folder that `~` expands to, and `platform` is the path flavor.
 */
export function fullReads(command, cwd, home, platform) {
  const path = pathFor(platform);
  const m = CAT.exec(command ?? "");
  if (!m) return [];
  const words = m[1].match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  return words
    .map((w) => w.replace(/^(['"])(.*)\1$/, "$2"))
    .filter((w) => !w.startsWith("-"))
    .map((w) => path.resolve(cwd, expandHome(w, home)));
}

/** Size and mtime of a file, or null when it cannot be read. */
export async function readStamp(io, abs) {
  try {
    const st = await io.fs.stat(abs);
    return st.kind === "file" ? { size: st.size, mtimeMs: st.mtimeMs } : null;
  } catch {
    return null;
  }
}

/** Record a full read of `abs` by `how` (the command or tool) in `state`. */
export async function recordRead(io, state, abs, how) {
  const stamp = await readStamp(io, abs);
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
export async function agentStarted(io, sessionId, agentId) {
  // The transcript layout is not documented, so a missing file falls back
  // to the marker's own time.
  const transcript = await io.session.agentTranscriptPath();
  await io.fs.write(
    pathFor(io.platform).join(
      stateDir(io),
      `${safeId(sessionId)}.${safeId(agentId)}${RUNNING}`,
    ),
    transcript,
  );
}

export async function agentStopped(io, sessionId, agentId) {
  await io.fs.remove(
    pathFor(io.platform).join(
      stateDir(io),
      `${safeId(sessionId)}.${safeId(agentId)}${RUNNING}`,
    ),
  );
}

/** Subagents of a session that started, did not stop, and are not idle. */
export async function runningAgents(io, sessionId, idleMs, now = Date.now()) {
  const path = pathFor(io.platform);
  const dir = stateDir(io);
  const prefix = `${safeId(sessionId)}.`;
  let count = 0;
  let names;
  try {
    names = (await io.fs.list(dir)).map((e) => e.name);
  } catch {
    // No folder, so no agent started.
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(RUNNING)) continue;
    try {
      const marker = path.join(dir, name);
      let last = (await io.fs.stat(marker)).mtimeMs;
      const transcript = await io.fs.read(marker);
      if (transcript && (await io.fs.exists(transcript)))
        last = Math.max(last, (await io.fs.stat(transcript)).mtimeMs);
      if (now - last < idleMs) count += 1;
    } catch {
      // The agent stopped while this loop ran.
    }
  }
  return count;
}
