// Bash guard rules for filesystem deletes, disk writes, permission changes,
// and printing secret files.

import fs from "node:fs";
import path from "node:path";
import { git, isFlagCluster, isUnder, targets } from "./_bash-args.mjs";
import { program } from "./_shell.mjs";

// --- filesystem -------------------------------------------------------------

const TEMP_PREFIXES = [
  "/tmp/",
  "/private/tmp/",
  "/var/folders/",
  "/private/var/folders/",
  "/dev/shm/",
];

// A named entry under `$TMPDIR` when the hook does not know its value, such
// as `$TMPDIR/build-1`. A variable can follow the literal start of the name.
// The temp folder itself, a bare glob in it (`$TMPDIR/*`), and a name that
// starts with a variable still ask. Absolute temp paths go through `scratch`
// and `tempHead`, because a project can itself live in a temp folder.
const TEMP_CHILD = /^(\$TMPDIR|\$\{TMPDIR\})\/+[^$*?[/\s][^*?[\s]*$/;

const ROOTISH = new Set([
  "/",
  "/*",
  "~",
  "~/",
  "~/*",
  "$HOME",
  "$\\{HOME}",
  "$HOME/",
  "$\\{HOME}/",
  "$HOME/*",
]);

const SYSTEM_DIRS = new Set([
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/opt",
  "/sbin",
  "/usr",
  "/var",
  "/System",
  "/Library",
  "/Applications",
  "/Users",
  "/home",
  "/root",
  "/Volumes",
  "/mnt",
  "/private",
]);

const BROAD = new Set([".", "./", "*", "./*", "..", "../", ".*"]);

function isRecursive(args) {
  for (const a of args) {
    if (a === "--") break;
    if (a === "--recursive" || (isFlagCluster(a) && /[rR]/.test(a)))
      return true;
  }
  return false;
}

// Claude Code keeps session scratchpads under `$CLAUDE_CODE_TMPDIR` when it
// is set, and that folder can be outside the system temp folders.
const TEMP_VARS = ["TMPDIR", "CLAUDE_CODE_TMPDIR"];

/** Temp folder prefixes, each with a trailing slash. */
function tempPrefixes() {
  const fromEnv = TEMP_VARS.map((name) =>
    process.env[name]?.replace(/\/+$/, ""),
  ).filter(Boolean);
  return [...TEMP_PREFIXES, ...fromEnv.map((dir) => `${dir}/`)];
}

function isTemp(p) {
  const s = `${p}/`;
  return tempPrefixes().some((prefix) => s.startsWith(prefix));
}

/** A path strictly inside a temp folder, not the folder itself. */
export function isTempChild(p) {
  return tempPrefixes().some(
    (prefix) => p.startsWith(prefix) && p.length > prefix.length,
  );
}

/**
 * A temp entry that holds no project files. A project can itself live in a
 * temp folder, and its files keep the project rules.
 */
function scratch(p, ctx) {
  return isTempChild(p) && !overlapsProject(p, ctx);
}

/**
 * The path with symbolic links resolved in its longest existing part. On
 * macOS, `/var/folders` and `/tmp` are links into `/private`.
 */
function canonical(p) {
  for (let head = p; ; head = path.dirname(head)) {
    try {
      return path.join(fs.realpathSync(head), path.relative(head, p));
    } catch {
      if (head === path.dirname(head)) return p;
    }
  }
}

/** True when `p` is inside the project or holds it. */
function overlapsProject(p, ctx) {
  const a = canonical(p);
  const root = canonical(ctx.root);
  return isUnder(a, root) || isUnder(root, a);
}

/**
 * Replace a leading `$TMPDIR` or `$CLAUDE_CODE_TMPDIR` with its value. The
 * value comes from the environment that Claude Code gives the hook and the
 * command. A command that assigns the variable itself keeps it unknown.
 */
function expandTempVar(target, ctx) {
  const m = /^\$(?:\{(\w+)\}|(\w+))(?=\/|$)/.exec(target);
  const name = m?.[1] ?? m?.[2];
  if (!TEMP_VARS.includes(name)) return target;
  if (new RegExp(`\\b${name}\\+?=`).test(ctx.command ?? "")) return target;
  const rest = target.slice(m[0].length);
  // A glob or a parent segment can reach past one named entry.
  if (/[*?[]/.test(rest) || rest.split("/").includes("..")) return target;
  const value = process.env[name]?.replace(/\/+$/, "");
  return value ? value + rest : target;
}

/**
 * True when a target with a run-time part (`/tmp/oc-$1`, `cd /tmp && rm -r
 * shots/$n`) stays inside one named temp entry: the literal text before the
 * first `$` resolves to a path strictly inside a temp folder.
 */
function tempHead(target, cmd, ctx) {
  const at = target.indexOf("$");
  if (at <= 0) return false;
  const head = target.slice(0, at);
  if (head.split("/").includes("..") || /[*?[~]/.test(head)) return false;
  const p = resolveTarget(head, cmd, ctx);
  if (!p || !scratch(p, ctx)) return false;
  if (head.endsWith("/")) return true;
  // The variable can complete the last name, for example `/tmp/pr$x` to the
  // project `/tmp/proj`.
  const rel = path.relative(canonical(path.dirname(p)), canonical(ctx.root));
  return !(rel && !rel.startsWith("..") && rel.startsWith(path.basename(p)));
}

/** True when `p` is inside the project and git ignores it. */
function ignoredInProject(p, ctx) {
  if (p === ctx.root || !isUnder(p, ctx.root)) return false;
  // The second form matches folder-only patterns (`dist/`) for a folder
  // that does not exist yet.
  // git does not report a folder that holds a tracked file as ignored.
  return Boolean(git(ctx.root, ["check-ignore", "--", p, `${p}/`])?.trim());
}

/**
 * True when a search root of `find` or `fd` keeps every match in a place
 * that holds no user work: a temp entry, a gitignored project path, or a
 * temp folder itself when a name filter selects the matches.
 */
function safeRoot(root, cmd, ctx, named) {
  const t = expandTempVar(root, ctx);
  if (tempHead(t, cmd, ctx)) return true;
  const p = resolveTarget(t, cmd, ctx);
  if (!p) return false;
  if (scratch(p, ctx)) return true;
  if (named && tempPrefixes().includes(`${p}/`) && !overlapsProject(p, ctx))
    return true;
  return ignoredInProject(p, ctx);
}

export function resolveTarget(target, cmd, ctx) {
  if (
    target.includes("$") ||
    target.startsWith("~") ||
    target.includes("__SUBST__")
  )
    return undefined;
  let base = ctx.cwd;
  if (cmd.cwdHint) {
    // `cd $DIR` makes the base unknown; guessing the project root misfires.
    if (cmd.cwdHint.includes("$")) return undefined;
    const home = process.env.HOME;
    if (/^~(\/|$)/.test(cmd.cwdHint)) {
      if (!home) return undefined;
      base = path.join(home, cmd.cwdHint.slice(1));
    } else if (cmd.cwdHint.startsWith("~")) return undefined;
    else base = path.resolve(ctx.cwd, cmd.cwdHint);
  }
  return path.resolve(base, target);
}

export function rm(cmd, ctx) {
  if (!isRecursive(cmd.args)) return [];
  const list = targets(cmd.args);
  if (!list.length)
    return [
      [
        "ask",
        "`rm -r` takes its targets from input (for example, through `xargs`)",
      ],
    ];
  const out = [];
  for (const t of list) {
    const stripped = t.replace(/\/+$/, "") || "/";
    if (ROOTISH.has(t) || ROOTISH.has(stripped) || SYSTEM_DIRS.has(stripped)) {
      out.push(["deny", `\`rm -r ${t}\` targets a home or system directory`]);
      continue;
    }
    if (TEMP_CHILD.test(t) && !t.split("/").includes("..")) continue;
    const expanded = expandTempVar(t, ctx);
    if (tempHead(expanded, cmd, ctx)) continue;
    const known = resolveTarget(expanded, cmd, ctx);
    if (known && scratch(known, ctx)) continue;
    if (
      BROAD.has(t) ||
      t.includes("__SUBST__") ||
      t.includes("$") ||
      t.startsWith("~")
    ) {
      out.push([
        "ask",
        `\`rm -r ${t}\` has a target that is broad or only known at run time`,
      ]);
      continue;
    }
    const p = resolveTarget(t, cmd, ctx);
    if (!p) continue;
    if (p === ctx.root || isUnder(ctx.root, p)) {
      out.push(["ask", `\`rm -r ${t}\` deletes the project root`]);
    } else if (isUnder(p, ctx.root)) {
      if (git(ctx.root, ["ls-files", "--", p])?.trim())
        out.push(["warn", `\`rm -r ${t}\` deletes git-tracked files`]);
      else if (
        git(ctx.root, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "--",
          p,
        ])?.trim()
      )
        out.push([
          "warn",
          `\`rm -r ${t}\` deletes files that git does not track, and git cannot restore them`,
        ]);
    } else if (!isTemp(p)) {
      out.push([
        "ask",
        `\`rm -r ${t}\` deletes outside the project (\`${p}\`)`,
      ]);
    }
  }
  return out;
}

// Directories and files that tools regenerate; bulk-deleting them loses nothing.
const CACHE_NAME =
  /^(__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.hypothesis|\.tox|\.nox|\.DS_Store|\*\.py[co]|\.eslintcache|\.turbo|\.parcel-cache|DerivedData)$/;

/** Every name pattern the command selects on is a regenerable cache. */
function cachesOnly(names) {
  return names.length > 0 && names.every((n) => CACHE_NAME.test(n));
}

// Operators and tests that make a `-name` filter no longer the whole selection.
const FIND_WIDENING = new Set([
  "-o",
  "-or",
  "-not",
  "!",
  ",",
  "-path",
  "-ipath",
  "-wholename",
  "-iwholename",
  "-regex",
  "-iregex",
]);

const DELETERS = ["rm", "shred", "unlink", "rmdir"];

/** `rm -rf {}`: a delete whose only operand is the matched path itself. */
function deletesMatchOnly(argv) {
  if (!DELETERS.includes(program(argv[0] ?? ""))) return false;
  const operands = argv.slice(1).filter((a) => !a.startsWith("-"));
  return operands.length === 1 && operands[0] === "{}";
}

// Options that make `find` or `fd` follow symbolic links out of the root.
const FOLLOW = new Set(["-L", "-H", "-follow", "--follow"]);

export function find(cmd, ctx) {
  const args = cmd.args;
  const names = args.flatMap((a, i) =>
    ["-name", "-iname"].includes(a) && args[i + 1] ? [args[i + 1]] : [],
  );
  // Actions: -delete, or -exec/-execdir/-ok/-okdir with the argv up to ; or +.
  const actions = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-delete") actions.push(["{}"]);
    else if (["-exec", "-execdir", "-ok", "-okdir"].includes(args[i])) {
      const end = args.findIndex((a, j) => j > i && (a === ";" || a === "+"));
      actions.push(args.slice(i + 1, end === -1 ? undefined : end));
      if (end === -1) break;
      i = end;
    }
  }
  const deleting = actions.filter(
    (argv) => argv[0] === "{}" || DELETERS.includes(program(argv[0] ?? "")),
  );
  if (!deleting.length) return [];
  // A cache cleanup: only cache names selected, and one action that deletes
  // exactly the match (not `{}/..`, not an extra path).
  const matchOnly = actions.every(
    (argv) => argv[0] === "{}" || deletesMatchOnly(argv),
  );
  if (
    !args.some((a) => FIND_WIDENING.has(a)) &&
    cachesOnly(names) &&
    actions.length === 1 &&
    matchOnly
  )
    return [];
  // Search roots come before the first option or expression.
  const end = args.findIndex((a) => /^[-(!]/.test(a));
  const roots = args.slice(0, end === -1 ? undefined : end);
  if (
    matchOnly &&
    !args.some((a) => FOLLOW.has(a)) &&
    (roots.length ? roots : ["."]).every((r) =>
      safeRoot(r, cmd, ctx, names.length > 0),
    )
  )
    return [];
  return args.includes("-delete")
    ? [["warn", "`find -delete` deletes every match"]]
    : [["warn", "`find -exec rm` deletes every match"]];
}

const FD_VALUE_FLAGS = new Set([
  "-e",
  "--extension",
  "-t",
  "--type",
  "-E",
  "--exclude",
  "-d",
  "--max-depth",
  "--min-depth",
  "-S",
  "--size",
  "-j",
  "--threads",
  "-c",
  "--color",
]);

export function fd(cmd, ctx) {
  const execAt = cmd.args.findIndex((a) =>
    ["-x", "--exec", "-X", "--exec-batch"].includes(a),
  );
  if (execAt === -1) return [];
  // fd passes everything after -x to the command, appending the path when no
  // placeholder is given.
  const exec = cmd.args.slice(execAt + 1);
  if (!DELETERS.includes(program(exec[0] ?? ""))) return [];
  const before = cmd.args.slice(0, execAt);
  // The first positional is the pattern, and the others are search roots.
  const positionals = [];
  const roots = [];
  for (let i = 0; i < before.length; i += 1) {
    if (FD_VALUE_FLAGS.has(before[i])) i += 1;
    else if (before[i] === "--search-path") {
      if (before[i + 1]) roots.push(before[i + 1]);
      i += 1;
    } else if (!before[i].startsWith("-")) positionals.push(before[i]);
  }
  const [pattern, ...paths] = positionals;
  roots.push(...paths);
  // fd patterns are regexes matched anywhere in the name (`.tox` matches
  // `detox.py`), so only a plain name or a --glob pattern counts as a cache.
  const glob = before.some((a) => a === "-g" || a === "--glob");
  const plain = pattern?.replace(/^\^|\$$/g, "") ?? "";
  const operands = exec.slice(1).filter((a) => !a.startsWith("-"));
  const matchOnly =
    operands.length === 0 || (operands.length === 1 && operands[0] === "{}");
  if (
    pattern &&
    (glob || !/[.*+?[\](){}|\\]/.test(plain)) &&
    cachesOnly([plain]) &&
    matchOnly
  )
    return [];
  if (
    matchOnly &&
    !before.some((a) => FOLLOW.has(a)) &&
    (roots.length ? roots : ["."]).every((r) =>
      safeRoot(r, cmd, ctx, Boolean(pattern)),
    )
  )
    return [];
  return [["warn", "`fd --exec rm` deletes every match"]];
}

export function disk(cmd) {
  switch (cmd.name) {
    case "wipefs":
    case "newfs":
      return [["ask", `\`${cmd.name}\` formats a device`]];
    case "dd":
      return cmd.args.some((a) => a.startsWith("of=/dev/"))
        ? [["ask", "`dd of=/dev/...` writes a raw device"]]
        : [];
    case "diskutil":
      return /^(erase|partition|zero|secureerase)/i.test(cmd.args[0] ?? "")
        ? [["ask", `\`diskutil ${cmd.args[0]}\` erases a disk`]]
        : [];
    default:
      return cmd.name.startsWith("mkfs")
        ? [["ask", `\`${cmd.name}\` formats a device`]]
        : [];
  }
}

export function chmod(cmd) {
  if (!isRecursive(cmd.args)) return [];
  const t = targets(cmd.args)
    .slice(1)
    .find((x) => ROOTISH.has(x) || SYSTEM_DIRS.has(x.replace(/\/+$/, "")));
  return t ? [["ask", `a recursive \`${cmd.name}\` changes \`${t}\``]] : [];
}

// --- secrets ----------------------------------------------------------------

const SECRET_NAME =
  /(^|\/)(\.env(\.(?!example|sample|template|dist)[\w.-]+)?|id_(rsa|dsa|ecdsa|ed25519)|[\w.-]+\.(pem|key|p12|pfx)|\.netrc|\.npmrc|\.pypirc|credentials(\.json)?)$/;

export const READERS = [
  "cat",
  "less",
  "more",
  "head",
  "tail",
  "bat",
  "strings",
  "xxd",
  "hexdump",
  "od",
  "base64",
  "nl",
];

export function secretRead(cmd) {
  const t = targets(cmd.args).find((x) => SECRET_NAME.test(x));
  return t ? [["ask", `\`${cmd.name}\` prints a secrets file (\`${t}\`)`]] : [];
}
