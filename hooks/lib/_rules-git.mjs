// Bash guard rules for git: history rewrites, discarded work, hook bypasses,
// and the staged-file check on commit.

import fs from "node:fs";
import path from "node:path";
import { git, hasFlag, positional } from "./_bash-args.mjs";

// --- git --------------------------------------------------------------------

const GIT_VALUE_FLAGS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);

const HOOK_ENV = {
  HUSKY: "0",
  HUSKY_SKIP_HOOKS: null,
  SKIP: null,
  PRE_COMMIT_ALLOW_NO_CONFIG: null,
  LEFTHOOK: "0",
  OVERCOMMIT_DISABLE: null,
};

// Config keys whose value names a program git runs (from `git help config`),
// so `git -c <key>=<value>` executes whatever the value says.
const EXEC_KEY =
  /^(core\.(fsmonitor|pager|editor|sshcommand|askpass|gitproxy|alternaterefscommand)|sequence\.editor|diff\.external|diff\..+\.(command|textconv)|(difftool|mergetool|browser|man|trailer|guitool)\..+\.cmd|merge\..+\.driver|filter\..+\.(clean|smudge|process)|credential\.(.+\.)?helper|pager\..+|gpg\.(.+\.)?program|gpg\.ssh\.defaultkeycommand|remote\..+\.(uploadpack|receivepack)|uploadpack\.packobjectshook|gc\.recentobjectshook|hook\..+\.command|interactive\.difffilter|alias\..+)$/;
// Values Claude sets itself to keep git non-interactive.
const BENIGN_PROGRAM = /^(|cat|less( -[a-z+]+)*|more|true|false|:)$/i;
// Environment variables that pick a program for git to run.
const EXEC_ENV = new Set([
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_EXTERNAL_DIFF",
  "GIT_PAGER",
  "GIT_EDITOR",
  "GIT_SEQUENCE_EDITOR",
  "GIT_ASKPASS",
  "GIT_PROXY_COMMAND",
]);

/** True when setting `key` to `value` (undefined: unknown) runs a program. */
function runsProgram(key, value) {
  const k = key.toLowerCase();
  if (!EXEC_KEY.test(k)) return false;
  if (value === undefined) return true;
  const v = value.trim();
  if (k.startsWith("alias.")) return v.startsWith("!");
  return !BENIGN_PROGRAM.test(v);
}

/** Config settings on a git command line or its environment that run a program. */
function execSettings(globals, sub, args, assigns) {
  const found = [];
  for (let i = 0; i < globals.length - 1; i += 1) {
    const value = globals[i + 1];
    const eq = value.indexOf("=");
    if (globals[i] === "-c") {
      const key = eq < 0 ? value : value.slice(0, eq);
      if (runsProgram(key, eq < 0 ? "true" : value.slice(eq + 1)))
        found.push(`-c ${key}`);
    } else if (globals[i] === "--config-env") {
      const key = value.slice(0, Math.max(eq, 0));
      if (runsProgram(key, undefined)) found.push(`--config-env ${key}`);
    }
  }
  for (const g of globals) {
    const m = /^--config-env=([^=]+)=/.exec(g);
    if (m && runsProgram(m[1], undefined)) found.push(`--config-env ${m[1]}`);
  }
  if (sub === "config") {
    const pos = positional(args);
    const at = pos.findIndex((a) => EXEC_KEY.test(a.toLowerCase()));
    if (at >= 0 && at + 1 < pos.length && runsProgram(pos[at], pos[at + 1]))
      found.push(`config ${pos[at]}`);
  }
  for (const [name, value] of Object.entries(assigns ?? {})) {
    if (EXEC_ENV.has(name) && !BENIGN_PROGRAM.test(String(value).trim()))
      found.push(name);
    const n = /^GIT_CONFIG_KEY_(\d+)$/.exec(name)?.[1];
    if (
      n !== undefined &&
      runsProgram(String(value), assigns[`GIT_CONFIG_VALUE_${n}`])
    )
      found.push(`${name}=${value}`);
  }
  return found;
}

export function gitSplit(args) {
  const globals = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (GIT_VALUE_FLAGS.has(a) && i + 1 < args.length) {
      globals.push(a, args[i + 1]);
      i += 1;
    } else if (a.startsWith("-")) {
      globals.push(a);
    } else {
      return { globals, sub: a, rest: args.slice(i + 1) };
    }
  }
  return { globals, sub: "", rest: [] };
}

export function isGitCommit(cmd) {
  return cmd.name === "git" && gitSplit(cmd.args).sub === "commit";
}

export function gitCwd(globals, ctx) {
  let cwd = ctx.cwd;
  for (let i = 0; i < globals.length - 1; i += 1) {
    if (globals[i] === "-C") cwd = path.resolve(cwd, globals[i + 1]);
  }
  return cwd;
}

// Commands that can bring back changes before a later discard in the same
// line runs. The worktree state at check time then says nothing.
const RESTORES_GIT = new Set([
  "apply",
  "am",
  "cherry-pick",
  "merge",
  "pull",
  "rebase",
]);

function restoresEarlier(cmd, ctx) {
  const at = ctx.commands?.indexOf(cmd) ?? -1;
  if (at === -1) return true;
  return ctx.commands.slice(0, at).some((c) => {
    if (c.name === "patch") return true;
    if (c.name !== "git") return false;
    const { sub, rest } = gitSplit(c.args);
    return (
      RESTORES_GIT.has(sub) ||
      (sub === "stash" && ["pop", "apply"].includes(rest[0]))
    );
  });
}

/** The folder git runs in, after an earlier `cd` and `-C`, or undefined. */
function discardCwd(cmd, globals, ctx) {
  if (globals.some((g) => /^--(git-dir|work-tree)/.test(g))) return undefined;
  let cwd = ctx.cwd;
  if (cmd.cwdHint) {
    if (/[$~`]/.test(cmd.cwdHint)) return undefined;
    cwd = path.resolve(cwd, cmd.cwdHint);
  }
  for (let i = 0; i < globals.length - 1; i += 1) {
    if (globals[i] !== "-C") continue;
    if (/[$~`]/.test(globals[i + 1])) return undefined;
    cwd = path.resolve(cwd, globals[i + 1]);
  }
  return cwd;
}

/**
 * True when the paths a discard overwrites can hold uncommitted work. An
 * empty `paths` means the whole worktree. Untracked files count for named
 * paths, because a checkout from another commit can overwrite them.
 */
function mayLoseWork(cmd, globals, ctx, paths) {
  if (paths.some((p) => /[$`]|__SUBST__/.test(p))) return true;
  if (restoresEarlier(cmd, ctx)) return true;
  const cwd = discardCwd(cmd, globals, ctx);
  if (!cwd) return true;
  const untracked = paths.length
    ? "--untracked-files=all"
    : "--untracked-files=no";
  const status = git(cwd, ["status", "--porcelain", untracked, "--", ...paths]);
  return status === undefined || status.trim() !== "";
}

/**
 * True when a reset to `rev` overwrites a file that git does not track now:
 * a path that `rev` has and `HEAD` does not, which exists on disk.
 */
function overwritesUntracked(cmd, globals, ctx, rev) {
  if (/[$`]|__SUBST__/.test(rev)) return true;
  const cwd = discardCwd(cmd, globals, ctx);
  if (!cwd) return true;
  const top = git(cwd, ["rev-parse", "--show-toplevel"])?.trim();
  const added = git(cwd, [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--diff-filter=A",
    "HEAD",
    rev,
    "--",
  ]);
  if (!top || added === undefined) return true;
  return added.split("\0").some((f) => f && fs.existsSync(path.join(top, f)));
}

/** Pathspecs after `--`, or the positionals after `skip` values. */
function pathspecs(args, valueFlags) {
  const dash = args.indexOf("--");
  if (dash !== -1) return args.slice(dash + 1);
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (valueFlags.includes(args[i])) i += 1;
    else if (!args[i].startsWith("-")) out.push(args[i]);
  }
  return out;
}

export function gitRule(cmd, ctx) {
  const { globals, sub, rest: args } = gitSplit(cmd.args);
  const out = [];
  if (globals.join(" ").toLowerCase().includes("core.hookspath"))
    out.push(["ask", "`git -c core.hooksPath=...` skips repository hooks"]);
  for (const setting of execSettings(globals, sub, args, cmd.assigns))
    out.push([
      "ask",
      `\`git\` with \`${setting}\` runs the program its value names`,
    ]);
  const pos = positional(args);
  switch (sub) {
    case "push":
      if (
        hasFlag(
          args,
          ["--force", "--force-with-lease", "--force-if-includes", "--mirror"],
          "f",
        ) ||
        pos.some((a) => a.startsWith("+"))
      ) {
        out.push(["ask", "`git push --force` rewrites remote history"]);
      }
      if (
        hasFlag(args, ["--delete"], "d") ||
        pos.some((a) => a.startsWith(":"))
      )
        out.push(["ask", "`git push --delete` deletes a remote ref"]);
      if (hasFlag(args, ["--no-verify"]))
        out.push(["ask", "`git push --no-verify` skips pre-push hooks"]);
      break;
    case "reset": {
      if (!hasFlag(args, ["--hard", "--merge", "--keep"])) break;
      const end = args.indexOf("--");
      const rev = positional(end === -1 ? args : args.slice(0, end))[0];
      if (mayLoseWork(cmd, globals, ctx, []))
        out.push(["ask", "`git reset --hard` discards uncommitted changes"]);
      else if (rev && overwritesUntracked(cmd, globals, ctx, rev))
        out.push([
          "ask",
          `\`git reset --hard ${rev}\` overwrites files that git does not track`,
        ]);
      break;
    }
    case "clean":
      if (hasFlag(args, ["--force"], "f") && !hasFlag(args, ["--dry-run"], "n"))
        out.push(["ask", "`git clean -f` deletes untracked files"]);
      break;
    case "checkout":
      if (
        (args.includes("--") ||
          args.includes(".") ||
          hasFlag(args, ["--force"], "f")) &&
        mayLoseWork(
          cmd,
          globals,
          ctx,
          args.includes("--") ? args.slice(args.indexOf("--") + 1) : [],
        )
      ) {
        out.push([
          "ask",
          "`git checkout -- <paths>` discards uncommitted changes",
        ]);
      }
      break;
    case "restore":
      if (
        (!hasFlag(args, ["--staged"], "S") ||
          hasFlag(args, ["--worktree"], "W")) &&
        mayLoseWork(cmd, globals, ctx, pathspecs(args, ["-s", "--source"]))
      )
        out.push(["ask", "`git restore` discards uncommitted changes"]);
      break;
    case "stash":
      if (["drop", "clear"].includes(args[0]))
        out.push(["ask", `\`git stash ${args[0]}\` deletes stashed work`]);
      break;
    case "branch":
      if (
        hasFlag(args, [], "D") ||
        (hasFlag(args, ["--delete"], "d") && hasFlag(args, ["--force"], "f"))
      ) {
        out.push(["ask", "`git branch -D` deletes an unmerged branch"]);
      }
      break;
    case "filter-branch":
    case "filter-repo":
      out.push(["ask", `\`git ${sub}\` rewrites history`]);
      break;
    case "update-ref":
      if (hasFlag(args, [], "d"))
        out.push(["ask", "`git update-ref -d` deletes a ref"]);
      break;
    case "add": {
      const cwd = gitCwd(globals, ctx);
      const binaries = pos.filter((f) => isExecutable(path.resolve(cwd, f)));
      if (binaries.length)
        out.push([
          "warn",
          `\`git add\` stages an executable binary: ${binaries.map((f) => `\`${f}\``).join(", ")}. An analysed or built binary is usually not committed`,
        ]);
      break;
    }
    case "reflog":
      if (["expire", "delete"].includes(args[0]))
        out.push(["ask", `\`git reflog ${args[0]}\` deletes recovery points`]);
      break;
    case "worktree":
      if (args[0] === "remove" && hasFlag(args, ["--force"], "f")) {
        const target = positional(args.slice(1))[0];
        const dirty = target
          ? git(path.resolve(gitCwd(globals, ctx), target), [
              "status",
              "--porcelain",
            ])
          : null;
        if (dirty?.trim())
          out.push([
            "ask",
            `\`git worktree remove --force\` deletes uncommitted changes in \`${target}\``,
          ]);
      }
      break;
    case "config":
      if (
        args.some((a) => a.toLowerCase() === "core.hookspath") &&
        pos.length > 1
      )
        out.push([
          "ask",
          "`git config core.hooksPath` with a value changes which hooks run",
        ]);
      break;
    default:
      break;
  }
  if (
    ["commit", "merge", "am", "rebase", "cherry-pick"].includes(sub) &&
    hasFlag(args, ["--no-verify"])
  ) {
    out.push(["ask", `\`git ${sub} --no-verify\` skips hooks`]);
  }
  if (
    sub === "commit" &&
    hasFlag(args, [], "n") &&
    !hasFlag(args, ["--dry-run"])
  )
    out.push(["ask", "`git commit -n` skips hooks"]);
  if (sub === "commit" || sub === "push") {
    for (const [key, value] of Object.entries(cmd.assigns)) {
      if (
        Object.hasOwn(HOOK_ENV, key) &&
        (HOOK_ENV[key] === null || HOOK_ENV[key] === value)
      ) {
        out.push(["ask", `\`${key}=${value}\` disables git hooks`]);
      }
    }
  }
  if (sub === "commit" && ctx.commitHygiene)
    out.push(...commitHygiene(args, gitCwd(globals, ctx)));
  return out;
}

/**
 * True when `file` starts with an ELF, Mach-O, or PE header. A fat Mach-O
 * shares its magic with a Java class file, so its architecture count must be
 * small. A PE file starts with `MZ`, and the offset at 0x3c points to
 * `PE\0\0`.
 */
function isExecutable(file) {
  let fd;
  try {
    if (!fs.statSync(file).isFile()) return false;
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(64);
    const n = fs.readSync(fd, head, 0, 64, 0);
    if (n < 4) return false;
    const magic = head.readUInt32BE(0);
    if (magic === 0x7f454c46) return true;
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic))
      return true;
    if (magic === 0xcafebabe) return n >= 8 && head.readUInt32BE(4) < 45;
    if (head[0] !== 0x4d || head[1] !== 0x5a || n < 64) return false;
    const sig = Buffer.alloc(4);
    fs.readSync(fd, sig, 0, 4, head.readUInt32LE(0x3c));
    return sig.equals(Buffer.from("PE\0\0", "latin1"));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const NOISE =
  /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.env(\.(?!example|sample|template|dist)[\w.-]+)?|id_(rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(pem|key|p12|pfx)|npm-debug\.log|[\w.-]+\.log)$|(^|\/)(node_modules|__pycache__|\.pytest_cache|\.mypy_cache|\.venv|venv|dist|build|target|\.next|coverage)\//;

const LOCKS = {
  "package-lock.json": ["package.json"],
  "yarn.lock": ["package.json"],
  "pnpm-lock.yaml": ["package.json", "pnpm-workspace.yaml"],
  "bun.lock": ["package.json"],
  "bun.lockb": ["package.json"],
  "Cargo.lock": ["Cargo.toml"],
  "poetry.lock": ["pyproject.toml"],
  "uv.lock": ["pyproject.toml"],
  "Gemfile.lock": ["Gemfile"],
  "composer.lock": ["composer.json"],
  "go.sum": ["go.mod"],
  "Package.resolved": ["Package.swift"],
};

function commitHygiene(args, cwd) {
  const staged = git(cwd, ["diff", "--cached", "--name-only"]);
  if (staged === undefined) return [];
  const files = new Set(staged.split("\n"));
  if (hasFlag(args, ["--all"], "a")) {
    for (const f of (git(cwd, ["diff", "--name-only"]) ?? "").split("\n"))
      files.add(f);
  }
  files.delete("");
  const out = [];
  const noise = [...files].filter((f) => NOISE.test(f)).sort();
  if (noise.length) {
    const shown =
      noise
        .slice(0, 6)
        .map((f) => `\`${f}\``)
        .join(", ") + (noise.length > 6 ? " ..." : "");
    out.push([
      "ask",
      `the commit includes files that are usually not committed: ${shown}`,
    ]);
  }
  for (const file of files) {
    const base = path.posix.basename(file);
    if (!Object.hasOwn(LOCKS, base)) continue;
    const dir = path.posix.dirname(file);
    const wanted = LOCKS[base].map((m) => (dir === "." ? m : `${dir}/${m}`));
    if (!wanted.some((m) => files.has(m)))
      out.push(["ask", `the commit changes \`${file}\` without its manifest`]);
  }
  return out;
}
