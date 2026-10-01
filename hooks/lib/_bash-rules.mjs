// Rules for the Bash guard.
//
// check(command, ctx) returns findings shaped [level, reason] with level
// "deny", "ask", or "warn" (a recoverable action that asks only outside auto
// mode; see decide() in _common.mjs). The guard never returns "allow": commands that match
// nothing fall through to Claude Code's normal permission flow.

import path from "node:path";
import { CLAUDE_TRAILER } from "./_attribution.mjs";
import { positional } from "./_bash-args.mjs";
import { commandBase, expandHome, writeTargets } from "./_bash-writes.mjs";
import { check as editCheck } from "./_edit-rules.mjs";
import { PROTECTED_REASON, protectedMatch, protectedUnder } from "./_loop.mjs";
import { contribution } from "./_rules-contrib.mjs";
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
import { gitRule, gitSplit, isGitCommit } from "./_rules-git.mjs";
import { claude, modelEnv, rawSettingsWrite } from "./_rules-model.mjs";
import { curl, gh, PUBLISH, publish, wget } from "./_rules-remote.mjs";
import { ignoredWalk } from "./_rules-search.mjs";
import { settingsWrite } from "./_rules-settings.mjs";
import { parse, program, readsStdinScript } from "./_shell.mjs";

/**
 * @typedef {{root: string, cwd: string, allowedModels: string[], modelLock?: boolean, editGuard?: boolean, commitHygiene?: boolean, claudeTrailerOff?: boolean, background?: boolean, ghUser?: string, oracle?: {root: string, globs: string[]}}} Context
 * @typedef {["deny" | "ask" | "warn", string]} Finding
 */

/** @returns {Finding[]} */
export function check(command, ctx) {
  const parsed = parse(command);
  const c = {
    modelLock: true,
    editGuard: true,
    commitHygiene: true,
    ...ctx,
    command,
    commands: parsed.commands,
  };
  const findings = parsed.commands.flatMap((cmd) => checkCommand(cmd, c));
  if (parsed.unparsed.length) findings.push(...rawScan(command));
  findings.push(
    ...parsed.commands.flatMap((cmd) => endless(cmd, c, BOUNDED.test(command))),
  );
  if (c.background) findings.push(...openStdin(command, parsed.commands));
  if (
    c.claudeTrailerOff &&
    CLAUDE_TRAILER.test(command) &&
    parsed.commands.some(isGitCommit)
  )
    findings.push([
      "deny",
      "the commit message has a Claude `Co-Authored-By` line, but the attribution settings exclude it. Remove the line. Then commit again",
    ]);
  if (c.modelLock) findings.push(...rawSettingsWrite(command));
  findings.push(...settingsWrite(command));
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
  if (cmd.name === "gh" || cmd.name === "git")
    out.push(...contribution(cmd, ctx));
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
        `the output of \`${producer}\` piped into \`${cmd.name}\` runs unreviewed commands`,
      ]);
    }
  }
  if (INTERPRETERS.has(cmd.name)) {
    out.push(...interpreterInline(cmd, ctx));
  }
  out.push(...snapshotBless(cmd));
  if (ctx.editGuard) out.push(...fileWrites(cmd, ctx));
  if (ctx.editGuard && ctx.oracle) out.push(...oracleRemovals(cmd, ctx));
  out.push(...ignoredWalk(cmd, ctx));
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
  /(os\.system|subprocess|child_process|execSync|spawnSync|exec\(|system\(|popen|Bun\.\$|Deno\.Command)/;

// Backticks and `%x` run a shell only in these languages. In Python they are
// plain text (often Markdown), and in JavaScript they are template literals.
const BACKTICK_SHELL = new Set(["perl", "ruby", "php"]);

const STRING_LIT = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g;

const HASH_COMMENTS = new Set([
  "python",
  "python3",
  "python2",
  "perl",
  "ruby",
  "php",
]);
const SLASH_COMMENTS = new Set(["node", "bun", "deno", "php"]);
const TEMPLATES = new Set(["node", "bun", "deno"]);

/**
 * The code of an inline script with its comments removed and each string
 * literal replaced by `""`. A delete call named in a comment or a string is
 * not a call. Only the `${...}` parts of a template literal stay, because
 * they run.
 */
function codeOnly(code, lang) {
  let i = 0;
  const scan = (inExpr) => {
    let out = "";
    let depth = 0;
    while (i < code.length) {
      const c = code[i];
      const two = code.slice(i, i + 2);
      const three = code.slice(i, i + 3);
      if (inExpr && c === "{") depth += 1;
      if (inExpr && c === "}" && depth-- === 0) {
        i += 1;
        return out;
      }
      // `$#a` and `s#a#b#` in Perl are code, not comments.
      if (
        HASH_COMMENTS.has(lang) &&
        c === "#" &&
        !/[\w$]/.test(code[i - 1] ?? "")
      ) {
        while (i < code.length && code[i] !== "\n") i += 1;
      } else if (SLASH_COMMENTS.has(lang) && two === "//") {
        while (i < code.length && code[i] !== "\n") i += 1;
      } else if (SLASH_COMMENTS.has(lang) && two === "/*") {
        const end = code.indexOf("*/", i + 2);
        i = end === -1 ? code.length : end + 2;
      } else if (three === '"""' || three === "'''") {
        const end = code.indexOf(three, i + 3);
        i = end === -1 ? code.length : end + 3;
        out += '""';
      } else if (c === "'" || c === '"') {
        i += 1;
        while (i < code.length && code[i] !== c && code[i] !== "\n")
          i += code[i] === "\\" ? 2 : 1;
        i += 1;
        out += '""';
      } else if (TEMPLATES.has(lang) && c === "`") {
        i += 1;
        while (i < code.length && code[i] !== "`") {
          if (code[i] === "\\") i += 2;
          else if (code.startsWith("${", i)) {
            i += 2;
            out += ` ${scan(true)} `;
          } else i += 1;
        }
        i += 1;
        out += '""';
      } else {
        out += c;
        i += 1;
      }
    }
    return out;
  };
  return scan(false);
}

function interpreterInline(cmd, ctx) {
  let code;
  for (let i = 0; i < cmd.args.length - 1; i += 1) {
    if (INLINE_FLAGS.has(cmd.args[i])) {
      code = cmd.args[i + 1];
      break;
    }
  }
  if (code === undefined && cmd.heredoc && positional(cmd.args).length === 0)
    code = cmd.heredoc;
  if (!code) return [];
  const out = [];
  if (DESTRUCTIVE_CODE.test(codeOnly(code, cmd.name)))
    out.push(["warn", `inline \`${cmd.name}\` code deletes files`]);
  if (
    SHELL_OUT.test(code) ||
    (BACKTICK_SHELL.has(cmd.name) && /`|%x/.test(code))
  ) {
    for (const match of code.matchAll(STRING_LIT)) {
      const literal = match[1] ?? match[2] ?? "";
      if (literal.includes(" ")) out.push(...check(literal, ctx));
    }
  }
  return out;
}

// --- file writes ------------------------------------------------------------

// A Bash write gets the same Edit rules as the edit tools, so a heredoc cannot
// weaken a test or break frontmatter that `Write` would have caught.
function fileWrites(cmd, ctx) {
  const base = commandBase(cmd, ctx.cwd);
  if (!base) return [];
  const out = [];
  for (const { target, content } of writeTargets(cmd, base)) {
    if (/\$|__SUBST__|^\/dev\//.test(target)) continue;
    const file_path = path.resolve(base, expandHome(target));
    const input =
      content === undefined
        ? ["Edit", { file_path, old_string: "", new_string: "" }]
        : ["Write", { file_path, content }];
    for (const [level, reason] of editCheck(...input, {
      allowedModels: ctx.allowedModels,
      modelLock: ctx.modelLock,
      bashWrite: true,
      oracle: ctx.oracle,
    }))
      out.push([level, `\`${cmd.name}\` writes \`${target}\`: ${reason}`]);
  }
  return out;
}

// `rm` and `git rm` of an oracle file, and `mv` or `git mv` away from one.
// `fileWrites` covers the files that a command writes.
function oracleRemovals(cmd, ctx) {
  let base = commandBase(cmd, ctx.cwd);
  if (!base) return [];
  let args = cmd.args;
  let sub = cmd.name;
  if (cmd.name === "git") {
    const split = gitSplit(cmd.args);
    ({ sub, rest: args } = split);
    for (let i = 0; i < split.globals.length - 1; i += 1)
      if (split.globals[i] === "-C")
        base = path.resolve(base, split.globals[i + 1]);
    if (!["rm", "mv"].includes(sub)) return [];
  } else if (!["rm", "unlink", "mv"].includes(sub)) return [];
  let operands = args.filter((a) => a && !a.startsWith("-"));
  if (sub === "mv") operands = operands.slice(0, -1);
  const { root, globs } = ctx.oracle;
  const out = [];
  for (const target of operands) {
    if (/\$|__SUBST__/.test(target)) continue;
    const file = path.resolve(base, expandHome(target));
    const glob =
      protectedMatch(file, root, globs) ?? protectedUnder(file, root, globs);
    if (glob)
      out.push([
        "deny",
        `\`${cmd.name}\` removes \`${target}\`: ${PROTECTED_REASON(glob)}`,
      ]);
  }
  return out;
}

// --- commands that do not end -----------------------------------------------

// A shell `&` (not `&&`, `>&`, or `&>`) or a `timeout` wrapper ends the call.
const BOUNDED = /(?:^|[^&>|])&(?![&>])|(?:^|[\s;&|(])g?timeout\s/;
const SCRIPT_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SERVER_SCRIPTS = new Set(["dev", "serve", "watch"]);

const FOLLOW =
  "never ends by itself. In the background it runs until the session ends, also after the line you wait for arrives or the file is deleted. To wait for one line, run `until grep -q '<pattern>' <file>; do sleep 1; done` with `run_in_background: true`. To get each new line as an event, use `Monitor`, which stops after `timeout_ms`. Otherwise put `timeout <seconds>` before the command";

/** A file follow: `tail -f`, `tail -F`, `tail --follow`, `inotifywait -m`. */
function follows(cmd) {
  const args = cmd.args;
  return (
    (cmd.name === "tail" &&
      args.some(
        (a) => /^--follow(?:=|$)/.test(a) || /^-[a-zA-Z]*[fF]/.test(a),
      )) ||
    (cmd.name === "inotifywait" &&
      args.some((a) => a === "--monitor" || /^-[a-zA-Z]*m/.test(a)))
  );
}

/**
 * A command that does not end. A follow is denied in both modes, because in
 * the background it outlives its purpose. A dev server, a watcher, or
 * Ghidra's headless analyzer is denied only in the foreground.
 */
function endless(cmd, ctx, bounded) {
  // A shell `&` does not end a follow: the follow runs on in the background.
  if (follows(cmd))
    return cmd.bounded ? [] : [["deny", `\`${cmd.argv.join(" ")}\` ${FOLLOW}`]];
  if (ctx.background || bounded) return [];
  const args = cmd.args;
  const script = args[0] === "run" ? args[1] : args[0];
  const found =
    (SCRIPT_RUNNERS.has(cmd.name) && SERVER_SCRIPTS.has(script)) ||
    args.some((a) => /^--watch(?:All)?(?:=true)?$/.test(a)) ||
    cmd.name === "analyzeHeadless";
  if (!found) return [];
  return [
    [
      "deny",
      `\`${cmd.argv.join(" ")}\` does not end by itself or runs for a long time, so in the foreground it blocks the turn until the Bash timeout. Run the same command with \`run_in_background: true\`. Then read its output file, or wait for a line with \`Monitor\``,
    ],
  ];
}

// --- background commands that wait on stdin --------------------------------

/**
 * Commands that read stdin to its end before they do their work. A
 * background call's stdin is usually `/dev/null`, but in one session it was a
 * pipe that never closed, and two `codex exec … &` runs waited 81 minutes on
 * it. Each entry was measured to wait on an open pipe. `claude -p` is not an
 * entry: it goes on after 3 s without stdin.
 */
const NO_OPERAND = new Set(["cat"]);
const SCRIPT_FLAGS = {
  python: /^-[a-zA-Z]*[cm]/,
  python3: /^-[a-zA-Z]*[cm]/,
  node: /^(?:-[ep]|--eval|--print|--test)/,
};
function readsOpenStdin(cmd) {
  const { name, args } = cmd;
  if (args.some((a) => /^(?:-h|--help|-V|--version)$/.test(a))) return false;
  if (name === "codex") return args[0] === "exec" || args[0] === "e";
  if (name === "tr") return true;
  if (NO_OPERAND.has(name))
    return args.every((a) => a === "-" || a.startsWith("-"));
  if (name in SCRIPT_FLAGS)
    return (
      !args.some((a) => SCRIPT_FLAGS[name].test(a)) &&
      args.every((a) => a === "-" || a.startsWith("-"))
    );
  return readsStdinScript(cmd);
}

// `exec </dev/null` gives every later command of the script a closed stdin.
const EXEC_STDIN = /(?:^|[;&|\n(]\s*)exec\s+0?<\s*\S/;

function openStdin(command, commands) {
  if (EXEC_STDIN.test(command)) return [];
  return commands
    .filter(
      (cmd) => readsOpenStdin(cmd) && !cmd.stdinRedirect && !cmd.pipedFrom,
    )
    .map((cmd) => [
      "deny",
      `\`${cmd.argv.slice(0, 2).join(" ")}\` reads stdin to its end before it starts work. In the background, stdin can be a pipe that does not close, and then the command waits and does not end. Add \`</dev/null\` to the command, or give it its input with a pipe, a file, or a heredoc`,
    ]);
}

// --- fallback ---------------------------------------------------------------

const RAW_PATTERNS = [
  [
    /\brm\s+-[a-zA-Z]*[rR]/,
    "the guard could not parse this command, and it contains a recursive `rm`",
  ],
  [
    /\bgit\s+(push\s+.*(-f|--force)|reset\s+--hard|clean\s+-[a-z]*f)/,
    "the guard could not parse this command, and it contains a destructive `git` command",
  ],
  [
    /\|\s*(ba|z|da|k)?sh\b/,
    "the guard could not parse this command, and it pipes into a shell",
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
