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
        out.push(["ask", `\`rm -r ${t}\` deletes git-tracked files`]);
    } else if (!isTemp(p)) {
      out.push(["ask", `\`rm -r ${t}\` deletes outside the project (${p})`]);
    }
  }
  return out;
}

export function find(cmd) {
  const args = cmd.args;
  if (args.includes("-delete"))
    return [["ask", "`find -delete` removes every match"]];
  for (let i = 0; i < args.length - 1; i += 1) {
    if (
      ["-exec", "-execdir", "-ok", "-okdir"].includes(args[i]) &&
      ["rm", "shred", "unlink", "rmdir"].includes(program(args[i + 1]))
    ) {
      return [
        ["ask", `\`find ${args[i]} ${args[i + 1]}\` removes every match`],
      ];
    }
  }
  return [];
}

export function fd(cmd) {
  const exec = cmd.args.some((a) =>
    ["-x", "--exec", "-X", "--exec-batch"].includes(a),
  );
  return exec && cmd.args.some((a) => program(a) === "rm")
    ? [["ask", "`fd --exec rm` removes every match"]]
    : [];
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
