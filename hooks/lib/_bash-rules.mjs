// Rules for the Bash guard.
//
// check(command, ctx) returns findings shaped [level, reason] with level
// "deny", "ask", or "warn" (a recoverable action that asks only outside auto
// mode; see decide() in _common.mjs). The guard never returns "allow": commands that match
// nothing fall through to Claude Code's normal permission flow.

import { positional } from "./_bash-args.mjs";
import { DB_CLIENTS, db, dbReset, snapshotBless } from "./_rules-data.mjs";
import {
  chmod,
  disk,
  fd,
  find,
  READERS,
  rm,
  secretRead,
} from "./_rules-filesystem.mjs";
import { gitRule } from "./_rules-git.mjs";
import { claude, codex, modelEnv, rawSettingsWrite } from "./_rules-model.mjs";
import { curl, gh, PUBLISH, publish, wget } from "./_rules-remote.mjs";
import { parse, program, readsStdinScript } from "./_shell.mjs";

/**
 * @typedef {{root: string, cwd: string, allowedModels: string[], codexModels?: string[], modelLock?: boolean, commitHygiene?: boolean}} Context
 * @typedef {["deny" | "ask" | "warn", string]} Finding
 */

/** @returns {Finding[]} */
export function check(command, ctx) {
  const c = { modelLock: true, commitHygiene: true, ...ctx };
  const parsed = parse(command);
  const findings = parsed.commands.flatMap((cmd) => checkCommand(cmd, c));
  if (parsed.unparsed.length) findings.push(...rawScan(command));
  if (c.modelLock) findings.push(...rawSettingsWrite(command));
  const seen = new Set();
  return findings.filter(([level, reason]) => {
    const key = `${level}\0${reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function checkCommand(cmd, ctx) {
  const out = [];
  const handler = HANDLERS[cmd.name];
  if (handler) out.push(...handler(cmd, ctx));
  if (readsStdinScript(cmd) && cmd.pipedFrom) {
    const producer = program(cmd.pipedFrom[0]);
    if (isDecoder(producer, cmd.pipedFrom.slice(1))) {
      out.push([
        "deny",
        `decoded data piped into \`${cmd.name}\` executes commands nobody can review`,
      ]);
    } else {
      out.push([
        "ask",
        `output of \`${producer}\` piped into \`${cmd.name}\` runs unreviewed commands`,
      ]);
    }
  }
  if (INTERPRETERS.has(cmd.name)) out.push(...interpreterInline(cmd, ctx));
  out.push(...snapshotBless(cmd));
  if (ctx.modelLock) out.push(...modelEnv(cmd, ctx));
  return out;
}

// --- interpreters -----------------------------------------------------------

const INTERPRETERS = new Set([
  "python",
  "python3",
  "python2",
  "node",
  "bun",
  "deno",
  "perl",
  "ruby",
  "php",
  "osascript",
]);

const INLINE_FLAGS = new Set([
  "-c",
  "-e",
  "-E",
  "-r",
  "--eval",
  "-p",
  "--print",
]);

const DESTRUCTIVE_CODE =
  /(shutil\.rmtree|os\.(remove|unlink|rmdir|removedirs)|Path\([^)]*\)\.(unlink|rmdir)|\.rmSync|\.rmdirSync|\.unlinkSync|fs\.rm\(|fs\.promises\.rm|rimraf|FileUtils\.rm|File\.delete|unlink\s*\(|rmtree|Deno\.remove)/;

const SHELL_OUT =
  /(os\.system|subprocess|child_process|execSync|spawnSync|exec\(|system\(|popen|`|Bun\.\$|Deno\.Command|%x)/;

const STRING_LIT = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g;

function interpreterInline(cmd, ctx) {
  let code = null;
  for (let i = 0; i < cmd.args.length - 1; i += 1) {
    if (INLINE_FLAGS.has(cmd.args[i])) {
      code = cmd.args[i + 1];
      break;
    }
  }
  if (code === null && cmd.heredoc && positional(cmd.args).length === 0)
    code = cmd.heredoc;
  if (!code) return [];
  const out = [];
  if (DESTRUCTIVE_CODE.test(code))
    out.push(["warn", `inline \`${cmd.name}\` code deletes files`]);
  if (SHELL_OUT.test(code)) {
    for (const match of code.matchAll(STRING_LIT)) {
      const literal = match[1] ?? match[2] ?? "";
      if (literal.includes(" ")) out.push(...check(literal, ctx));
    }
  }
  return out;
}

// --- fallback ---------------------------------------------------------------

const RAW_PATTERNS = [
  [
    /\brm\s+-[a-zA-Z]*[rR]/,
    "recursive rm in a command the guard could not parse",
  ],
  [
    /\bgit\s+(push\s+.*(-f|--force)|reset\s+--hard|clean\s+-[a-z]*f)/,
    "destructive git command in a command the guard could not parse",
  ],
  [
    /\|\s*(ba|z|da|k)?sh\b/,
    "pipe into a shell in a command the guard could not parse",
  ],
];

function rawScan(command) {
  return RAW_PATTERNS.filter(([re]) => re.test(command)).map(([, reason]) => [
    "ask",
    reason,
  ]);
}

function isDecoder(name, args) {
  switch (name) {
    case "base64":
    case "base32":
    case "gbase64":
      return args.some((a) => ["-d", "-D", "--decode"].includes(a));
    case "xxd":
      return args.includes("-r");
    case "openssl":
      return (
        args.includes("-d") && args.some((a) => a === "enc" || a === "base64")
      );
    case "xz":
    case "gzip":
    case "bzip2":
      return args.includes("-d") || args.includes("--decompress");
    case "uudecode":
    case "gunzip":
    case "zcat":
    case "bunzip2":
    case "unxz":
      return true;
    default:
      return false;
  }
}

const HANDLERS = {
  rm,
  shred: rm,
  find,
  fd,
  dd: disk,
  diskutil: disk,
  wipefs: disk,
  newfs: disk,
  chmod,
  chown: chmod,
  git: gitRule,
  gh,
  curl,
  wget,
  claude,
  codex,
  yarn: publish,
  dropdb: dbReset,
  ...Object.fromEntries(Object.keys(PUBLISH).map((n) => [n, publish])),
  ...Object.fromEntries(DB_CLIENTS.map((n) => [n, db])),
  ...Object.fromEntries(READERS.map((n) => [n, secretRead])),
  ...Object.fromEntries(
    ["prisma", "npx", "bunx", "pnpx", "rails", "rake", "artisan"].map((n) => [
      n,
      dbReset,
    ]),
  ),
};
for (const mk of [
  "mkfs",
  "mkfs.ext4",
  "mkfs.fat",
  "mkfs.vfat",
  "mkfs.xfs",
  "mkfs.btrfs",
  "mkfs.apfs",
])
  HANDLERS[mk] = disk;
