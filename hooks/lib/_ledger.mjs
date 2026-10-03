// Per-session record of edits and check runs, used by the stop gate and the
// compaction carry-over. Stored under CLAUDE_PLUGIN_DATA, never in the repo.

import { git } from "./_bash-args.mjs";
import { expandHome, writeTargets } from "./_bash-writes.mjs";
import { stateDir } from "./_core.mjs";
import { pathFor } from "./_path.mjs";
import { gitSplit } from "./_rules-git.mjs";
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
export async function codeFile(io, rel, root) {
  if (NON_CODE.test(rel) || DOT_CONFIG.test(rel)) return false;
  // `check-ignore -q` exits 0 only for an ignored path.
  return (await git(io, root, ["check-ignore", "-q", "--", rel])) === undefined;
}

function file(io, sessionId, agentId) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  return pathFor(io.platform).join(
    stateDir(io),
    `${safe(sessionId || "unknown")}${agentId ? `.${safe(agentId)}` : ""}.json`,
  );
}

/**
 * The sequence number of the last passing check that runs the code.
 * A check with no kind, from an older ledger, counts as a `run` check.
 */
export function lastRunSeq(state) {
  const check = state.lastCheck;
  return Math.max(
    state.lastRunSeq ?? -1,
    check && check.kind !== "static" && check.ok !== false ? check.seq : -1,
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

// The tail of the queue for each ledger file in this process.
const queues = new Map();

/**
 * Run `fn` when no other `withLedger` call of this process holds the same
 * ledger, and give its result. The hooks module runs the actions of parallel
 * tool calls at the same time, and each one loads, changes, and saves the
 * ledger, so without the queue one save replaces the other. The lock does
 * not reach other processes. Do not call `withLedger` for the same ledger
 * inside `fn`, because that call waits for `fn`.
 */
export async function withLedger(io, sessionId, agentId, fn) {
  const key = file(io, sessionId, agentId);
  const before = queues.get(key) ?? Promise.resolve();
  let release;
  const tail = before.then(() => new Promise((r) => (release = r)));
  queues.set(key, tail);
  await before;
  try {
    return await fn();
  } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
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
 * `home` is the folder that `~` expands to. `cwd` is `root` when it is not
 * given.
 */
export async function shellWrites(io, command, root, home, cwd = root) {
  const path = pathFor(io.platform);
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
    for (const { target } of await writeTargets(io, cmd, base, home, path)) {
      const rel = inProject(target, base);
      if (rel) out.add(rel);
    }
    for (const target of await gitWrites(io, cmd, base, home, path)) {
      const rel = inProject(target, base);
      if (rel) out.add(rel);
    }
  }
  return [...out];
}

// `git apply` options that only report or that change only the index.
const APPLY_NO_WRITE = /^--(check|stat|numstat|summary|cached)$/;

/**
 * The files that a patch text changes, from its `+++` lines. `fromTop` is
 * true for a file under a `diff --git` header, whose path git reads from the
 * top of the work tree.
 */
function patchEntries(text) {
  const out = [];
  let fromTop = false;
  for (const line of (text ?? "").split("\n")) {
    if (line.startsWith("diff ")) fromTop = line.startsWith("diff --git ");
    const m = /^\+\+\+ (\S+)/.exec(line);
    if (m && m[1] !== "/dev/null")
      out.push({ name: m[1].replace(/^[ab]\//, ""), fromTop });
  }
  return out;
}

/**
 * Files that `git apply`, `patch`, `git checkout -- <paths>`, or
 * `git restore <paths>` change in the work tree. The guard does not send
 * these through the Edit rules, because a restore only returns a file to a
 * committed state. Paths resolve against the directory of `git -C`.
 */
async function gitWrites(io, cmd, base, home, path) {
  const { globals, sub, rest } =
    cmd.name === "git" ? gitSplit(cmd.args) : { globals: [], rest: [] };
  for (let i = 0; i < globals.length - 1; i += 1)
    if (globals[i] === "-C")
      base = path.resolve(base, expandHome(globals[i + 1], home));
  const resolved = (files) =>
    files.map((f) => path.resolve(base, expandHome(f, home)));
  const stdin = async () =>
    cmd.stdinFile ? await patchText(cmd.stdinFile) : cmd.heredoc;
  const patchText = async (file) => {
    try {
      return await io.fs.read(path.resolve(base, expandHome(file, home)));
    } catch {
      return "";
    }
  };
  if (sub === "apply" && !rest.some((a) => APPLY_NO_WRITE.test(a))) {
    const files = rest.filter((a) => !a.startsWith("-"));
    const texts = files.length
      ? await Promise.all(files.map(patchText))
      : [await stdin()];
    // In a subfolder, git skips a `diff --git` path outside the subfolder.
    // It reads another path from the subfolder, but a path that starts with
    // the subfolder's own prefix it reads from the top.
    const prefix =
      (await git(io, base, ["rev-parse", "--show-prefix"]))?.trim() ?? "";
    const top = path.resolve(
      base,
      ...prefix
        .split("/")
        .filter(Boolean)
        .map(() => ".."),
    );
    return texts.flatMap(patchEntries).flatMap(({ name, fromTop }) => {
      const inPrefix = name.startsWith(prefix);
      if (fromTop && !inPrefix) return [];
      return [path.resolve(fromTop || inPrefix ? top : base, name)];
    });
  }
  if (cmd.name === "patch" && !cmd.args.includes("--dry-run")) {
    const i = cmd.args.findIndex((a) => a === "-i" || a === "--input");
    const given = cmd.args
      .find((a) => a.startsWith("--input="))
      ?.slice("--input=".length);
    const file = given ?? (i >= 0 ? cmd.args[i + 1] : undefined);
    const text = file ? await patchText(file) : await stdin();
    return resolved(patchEntries(text).map((e) => e.name));
  }
  if (sub === "checkout" && rest.includes("--"))
    return resolved(rest.slice(rest.indexOf("--") + 1));
  if (sub === "restore") {
    const staged = rest.some((a) => a === "--staged" || a === "-S");
    const worktree = rest.some((a) => a === "--worktree" || a === "-W");
    if (staged && !worktree) return [];
    const dash = rest.indexOf("--");
    return resolved(
      dash >= 0 ? rest.slice(dash + 1) : rest.filter((a) => !a.startsWith("-")),
    );
  }
  return [];
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
