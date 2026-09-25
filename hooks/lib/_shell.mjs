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
  buildCommands(tokens, bodies, result, depth);
  return result;
}

function merge(into, other) {
  into.commands.push(...other.commands);
  into.unparsed.push(...other.unparsed);
}

function buildCommands(tokens, heredocs, result, depth) {
  let current = [];
  let pendingHeredoc = null;
  let prevArgv = null;
  let pipeNext = false;
  let cwdHint = null;
  let heredocIndex = 0;

  const flush = (sep) => {
    if (current.length) {
      const cmd = unwrap(current);
      if (cmd.argv.length) {
        cmd.heredoc = pendingHeredoc;
        cmd.pipedFrom = pipeNext ? prevArgv : null;
        cmd.cwdHint = cwdHint;
        if (cmd.name === "cd" && cmd.args.length) cwdHint = cmd.args[0];
        result.commands.push(cmd);
        expandNested(cmd, result, depth);
        prevArgv = cmd.argv;
      }
    }
    current = [];
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
