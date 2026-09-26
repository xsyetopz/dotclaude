// Bash guard rules for filesystem deletes, disk writes, permission changes,
// and printing secret files.

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

function isTemp(p) {
  const s = `${p}/`;
  const tmpdir = process.env.TMPDIR;
  return (
    TEMP_PREFIXES.some((prefix) => s.startsWith(prefix)) ||
    Boolean(tmpdir && s.startsWith(`${tmpdir.replace(/\/+$/, "")}/`))
  );
}

function resolveTarget(target, cmd, ctx) {
  if (
    target.includes("$") ||
    target.startsWith("~") ||
    target.includes("__SUBST__")
  )
    return null;
  let base = ctx.cwd;
  if (cmd.cwdHint && !cmd.cwdHint.includes("$") && !cmd.cwdHint.startsWith("~"))
    base = path.resolve(ctx.cwd, cmd.cwdHint);
  return path.resolve(base, target);
}

export function rm(cmd, ctx) {
  if (!isRecursive(cmd.args)) return [];
  const list = targets(cmd.args);
  if (!list.length)
    return [
      ["ask", "`rm -r` takes its targets from input (for example via xargs)"],
    ];
  const out = [];
  for (const t of list) {
    const stripped = t.replace(/\/+$/, "") || "/";
    if (ROOTISH.has(t) || ROOTISH.has(stripped) || SYSTEM_DIRS.has(stripped)) {
      out.push(["deny", `\`rm -r ${t}\` targets a home or system directory`]);
      continue;
    }
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
    } else if (!isTemp(p)) {
      out.push(["ask", `\`rm -r ${t}\` deletes outside the project (${p})`]);
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
  "-prune",
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

export function find(cmd) {
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
  if (
    !args.some((a) => FIND_WIDENING.has(a)) &&
    cachesOnly(names) &&
    actions.length === 1 &&
    (actions[0][0] === "{}" || deletesMatchOnly(actions[0]))
  )
    return [];
  return args.includes("-delete")
    ? [["warn", "`find -delete` removes every match"]]
    : [["warn", "`find -exec rm` removes every match"]];
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

export function fd(cmd) {
  const execAt = cmd.args.findIndex((a) =>
    ["-x", "--exec", "-X", "--exec-batch"].includes(a),
  );
  if (execAt === -1) return [];
  // fd passes everything after -x to the command, appending the path when no
  // placeholder is given.
  const exec = cmd.args.slice(execAt + 1);
  if (!DELETERS.includes(program(exec[0] ?? ""))) return [];
  const before = cmd.args.slice(0, execAt);
  let pattern = null;
  for (let i = 0; i < before.length; i += 1) {
    if (FD_VALUE_FLAGS.has(before[i])) i += 1;
    else if (!before[i].startsWith("-")) {
      pattern = before[i];
      break;
    }
  }
  // fd patterns are regexes matched anywhere in the name (`.tox` matches
  // `detox.py`), so only a plain name or a --glob pattern counts as a cache.
  const glob = before.some((a) => a === "-g" || a === "--glob");
  const plain = pattern?.replace(/^\^|\$$/g, "") ?? "";
  const operands = exec.slice(1).filter((a) => !a.startsWith("-"));
  if (
    pattern &&
    (glob || !/[.*+?[\](){}|\\]/.test(plain)) &&
    cachesOnly([plain]) &&
    (operands.length === 0 || (operands.length === 1 && operands[0] === "{}"))
  )
    return [];
  return [["warn", "`fd --exec rm` removes every match"]];
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
  return t ? [["ask", `recursive \`${cmd.name}\` on ${t}`]] : [];
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
  return t ? [["ask", `\`${cmd.name}\` prints a secrets file (${t})`]] : [];
}
