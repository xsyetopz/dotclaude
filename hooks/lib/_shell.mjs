// Split a shell command line into simple commands the guards can inspect.
//
// This is not a shell. It handles the rewordings that defeat prefix-based
// permission rules: `VAR=` prefixes, wrappers such as sudo/env/timeout/xargs,
// `sh -c '...'`, `eval`, heredoc bodies fed to a shell, and `$(...)`/backtick
// substitutions. Text it cannot tokenize is returned in `unparsed` so the
// caller can fall back to a raw-text scan.

import { unwrap } from "./_shell-command.mjs";
import {
  extractHeredocs,
  extractSubstitutions,
  tokenize,
} from "./_shell-lexer.mjs";

export { program } from "./_shell-command.mjs";

export const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "mksh",
  "fish",
  "ash",
]);

const SEPARATORS = new Set([
  ";",
  "\n",
  "&&",
  "||",
  "|",
  "|&",
  "&",
  ";;",
  "(",
  ")",
  "{",
  "}",
]);

const REDIRECT = /^[0-9]*(<<<|<<-?|<>|>>|>&|<&|&>>|&>|>\||<|>)$/;

const OUTPUT_REDIRECT = /^[0-9]*(>>?|>\||&>>?|<>)$/;

const MAX_DEPTH = 4;

export function parse(command, depth = 0) {
  const result = { commands: [], unparsed: [] };
  if (depth > MAX_DEPTH || !command.trim()) return result;
  const { text: withoutHeredocs, bodies } = extractHeredocs(command);
  const { text, found } = extractSubstitutions(withoutHeredocs);
  for (const inner of found) merge(result, parse(inner, depth + 1));
  let tokens;
  try {
    tokens = tokenize(text);
  } catch {
    result.unparsed.push(command);
    return result;
  }
  buildCommands(
    tokens,
    bodies,
    result,
    depth,
    singlyAssigned(command),
    mktempVars(command),
  );
  return result;
}

function merge(into, other) {
  into.commands.push(...other.commands);
  into.unparsed.push(...other.unparsed);
}

function buildCommands(tokens, heredocs, result, depth, resolvable, temps) {
  let current = [];
  let redirects = [];
  let pendingHeredoc = null;
  let prevArgv = null;
  let pipeNext = false;
  let cwdHint = null;
  let heredocIndex = 0;
  const vars = {};

  const flush = (sep) => {
    if (current.length) {
      const cmd = unwrap(current.map((tok) => expandVars(tok, vars)));
      if (!cmd.argv.length || DECLARE.has(cmd.name))
        recordVars(cmd, vars, resolvable, temps);
      if (cmd.argv.length) {
        cmd.heredoc = pendingHeredoc;
        cmd.writes = redirects;
        cmd.pipedFrom = pipeNext ? prevArgv : null;
        cmd.cwdHint = cwdHint;
        if (cmd.name === "cd" && cmd.args.length) cwdHint = cmd.args[0];
        result.commands.push(cmd);
        expandNested(cmd, result, depth);
        prevArgv = cmd.argv;
      }
    }
    current = [];
    redirects = [];
    pendingHeredoc = null;
    pipeNext = sep === "|" || sep === "|&";
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (typeof tok === "object") {
      if (SEPARATORS.has(tok.op)) {
        flush(tok.op);
      } else if (REDIRECT.test(tok.op)) {
        if (tok.op.startsWith("<<") && tok.op !== "<<<") {
          pendingHeredoc = heredocs[heredocIndex] ?? "";
          heredocIndex += 1;
        } else if (tok.op === "<<<" && typeof tokens[i + 1] === "string") {
          pendingHeredoc = tokens[i + 1];
        } else if (
          OUTPUT_REDIRECT.test(tok.op) &&
          typeof tokens[i + 1] === "string"
        ) {
          redirects.push(tokens[i + 1]);
        }
        i += 1; // skip the redirect target
      }
    } else if (SEPARATORS.has(tok) && (tok === "{" || tok === "}")) {
      flush(tok);
    } else if (
      /^\d+$/.test(tok) &&
      typeof tokens[i + 1] === "object" &&
      REDIRECT.test(tokens[i + 1].op)
    ) {
      // file descriptor number before a redirect
    } else {
      current.push(tok);
    }
  }
  flush(null);
}

const DECLARE = new Set(["export", "local", "declare", "readonly", "typeset"]);
const LITERAL = /^[^$`*?[\]{}~]*$/;

const WRITES = [
  /(?:^|[\s;&|(!{`])(?:(?:export|local|declare|readonly|typeset)\s+(?:-\w+\s+)*)?([A-Za-z_]\w*)\+?=/g,
  /\bfor\s+([A-Za-z_]\w*)/g,
  /\bselect\s+([A-Za-z_]\w*)/g,
  /\bgetopts\s+\S+\s+([A-Za-z_]\w*)/g,
];
const MULTI_WRITES =
  /\b(read|unset|mapfile|readarray|printf\s+-v)\b([^;&|\n]*)/g;

// `S=$(mktemp -d)` with no directory argument creates a fresh path under the
// system temp directory; this stand-in resolves as a temp path.
const MKTEMP_PATH = "/tmp/dotclaude-mktemp.XXXXXX";
const MKTEMP_ASSIGN =
  /(?:^|[\s;&|(!{])([A-Za-z_]\w*)="?\$\(\s*mktemp((?:\s+[^\s)]+)*)\s*\)/g;

/** Names assigned `$(mktemp ...)` whose arguments name no directory. */
function mktempVars(command) {
  const out = new Set();
  for (const m of command.matchAll(MKTEMP_ASSIGN))
    if (!m[2].includes("/") && !/\s-p\b/.test(m[2])) out.add(m[1]);
  return out;
}

/**
 * Names written exactly once in the whole command line. Only these resolve:
 * `S=/tmp/x; S+=/../..; rm -rf $S` or `read S` keeps `$S` unknown, and any
 * `eval` turns resolution off.
 */
function singlyAssigned(command) {
  // eval re-parses at run time; IFS changes how every $VAR splits.
  if (/\beval\b|\bIFS\+?=/.test(command)) return new Set();
  const counts = new Map();
  const bump = (name, n = 1) => counts.set(name, (counts.get(name) ?? 0) + n);
  for (const re of WRITES) for (const m of command.matchAll(re)) bump(m[1]);
  // `read S` and friends write at run time; never resolve those names.
  for (const m of command.matchAll(MULTI_WRITES))
    for (const name of m[2].match(/[A-Za-z_]\w*/g) ?? []) bump(name, 2);
  return new Set([...counts].filter(([, n]) => n === 1).map(([k]) => k));
}

/**
 * Remember `S=/tmp/x` and `export S=/tmp/x` so a later `rm -rf $S` in the same
 * command line resolves to a path. Only literal values of names assigned once
 * count; `S=$(mktemp)` stays unknown.
 */
function recordVars(cmd, vars, resolvable, temps = new Set()) {
  const entries = Object.entries(cmd.assigns);
  for (const arg of cmd.args) {
    const eq = arg.indexOf("=");
    if (eq > 0 && /^[A-Za-z_]\w*$/.test(arg.slice(0, eq)))
      entries.push([arg.slice(0, eq), arg.slice(eq + 1)]);
  }
  for (const [key, value] of entries) {
    if (resolvable.has(key) && temps.has(key) && value === "__SUBST__")
      vars[key] = MKTEMP_PATH;
    else if (
      resolvable.has(key) &&
      value &&
      LITERAL.test(value) &&
      !/\s/.test(value) && // unquoted $S splits on whitespace
      !value.includes("__SUBST__")
    )
      vars[key] = value;
    else delete vars[key];
  }
}

function expandVars(token, vars) {
  if (typeof token !== "string" || !token.includes("$")) return token;
  return token.replace(/\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g, (m, a, b) =>
    Object.hasOwn(vars, a ?? b) ? vars[a ?? b] : m,
  );
}

/** Script string for `bash -c '...'` style invocations, or null. */
export function shellScript(cmd) {
  if (!SHELLS.has(cmd.name)) return null;
  const args = cmd.args;
  for (let idx = 0; idx < args.length; idx += 1) {
    const tok = args[idx];
    if (
      tok === "-c" ||
      (tok.startsWith("-") &&
        !tok.startsWith("--") &&
        tok.slice(1).includes("c"))
    ) {
      return args[idx + 1] ?? "";
    }
    if (!tok.startsWith("-")) return null; // running a script file
  }
  return null;
}

/** True for a bare shell that executes whatever arrives on stdin. */
export function readsStdinScript(cmd) {
  if (!SHELLS.has(cmd.name) || shellScript(cmd) !== null) return false;
  const positional = cmd.args.filter((a) => !a.startsWith("-"));
  return positional.length === 0 || positional[0] === "-";
}

function expandNested(cmd, result, depth) {
  const script = shellScript(cmd);
  if (script) merge(result, parse(script, depth + 1));
  else if (cmd.name === "eval" && cmd.args.length)
    merge(result, parse(cmd.args.join(" "), depth + 1));
  else if (cmd.heredoc && readsStdinScript(cmd))
    merge(result, parse(cmd.heredoc, depth + 1));
}
