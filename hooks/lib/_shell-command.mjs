// One simple command after `VAR=` prefixes and wrappers such as sudo, env,
// timeout, and xargs are stripped.

import { tokenize } from "./_shell-lexer.mjs";

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Normalize `/usr/bin/rm`, `\rm`, `C:\bin\rm` to `rm`. The name starts after
 * the last `/` or `\`. A trailing `/` does not count.
 */
export function program(token) {
  const name = token.replace(/^\\+/, "").replace(/\/+$/, "");
  return name.slice(
    Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1,
  );
}

// Wrappers whose flags we skip, with the flags that consume a value.
const WRAPPERS = {
  sudo: ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U"],
  doas: ["-u", "-C"],
  env: ["-u", "-C", "-S", "--unset", "--chdir", "--split-string"],
  nohup: [],
  time: ["-f", "-o"],
  command: [],
  builtin: [],
  exec: ["-a"],
  nice: ["-n", "--adjustment"],
  ionice: ["-c", "-n", "-t"],
  stdbuf: ["-i", "-o", "-e"],
  caffeinate: ["-t", "-w"],
  chronic: [],
  unbuffer: [],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  gtimeout: ["-s", "-k", "--signal", "--kill-after"],
  xargs: [
    "-I",
    "-i",
    "-n",
    "-P",
    "-L",
    "-l",
    "-d",
    "-E",
    "-e",
    "-s",
    "-a",
    "--max-args",
    "--max-procs",
    "--delimiter",
    "--arg-file",
    "--replace",
  ],
  watch: ["-n", "-d", "--interval"],
  uvx: ["--from", "--with", "--with-requirements", "--python", "-p", "--index"],
};

// Project runners whose `run` subcommand runs the next words as a command,
// with the flags that consume a value.
// `uv tool run` is the long form of `uvx`, so `uv` also has `--from`.
const RUNNERS = {
  uv: [
    "--from",
    "--with",
    "--with-requirements",
    "--with-editable",
    "--python",
    "-p",
    "--project",
    "--directory",
    "--package",
    "--group",
    "--extra",
    "--env-file",
    "--index",
  ],
  poetry: ["-C", "--directory", "-P", "--project"],
  pdm: ["-p", "--project"],
  pipenv: [],
};

const WRAPPER_POSITIONAL = { timeout: 1, gtimeout: 1 };

class Command {
  constructor(argv, assigns) {
    this.argv = argv;
    this.assigns = assigns;
    this.pipedFrom = null;
    // The heredoc of a `cat` that pipes into this command, or null.
    this.pipedInput = null;
    this.heredoc = null;
    this.cwdHint = null;
    this.writes = [];
    // The subset of `writes` that `>`, `>|`, or `&>` truncates first.
    this.overwrites = [];
    // True when a redirect or a heredoc gives the command its own stdin.
    this.stdinRedirect = false;
    // The file that `<` gives as stdin, or null.
    this.stdinFile = null;
    // True when a `timeout` wrapper ends the command.
    this.bounded = false;
  }

  get name() {
    return this.argv.length ? program(this.argv[0]) : "";
  }

  get args() {
    return this.argv.slice(1);
  }
}

// Reserved words that can precede a simple command (`do rm -rf x`,
// `then env -u X swift test`); the command after them is what runs.
const RESERVED = new Set([
  "do",
  "then",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "!",
]);

export function unwrap(input) {
  const assigns = {};
  let argv = [...input];
  let bounded = false;
  while (argv.length) {
    while (argv.length && RESERVED.has(argv[0])) argv.shift();
    while (argv.length && ASSIGN.test(argv[0])) {
      const [key, ...rest] = argv.shift().split("=");
      assigns[key] = rest.join("=");
    }
    if (!argv.length) break;
    const name = program(argv[0]);
    const run = runIndex(argv);
    if (run > 0) {
      argv.splice(0, run + 1);
      while (argv.length && argv[0].startsWith("-")) {
        const flag = argv.shift();
        if (flag === "--") break;
        if (RUNNERS[name].includes(flag) && argv.length) argv.shift();
      }
      continue;
    }
    if (!Object.hasOwn(WRAPPERS, name)) break;
    const valueFlags = WRAPPERS[name];
    argv.shift();
    if (name in WRAPPER_POSITIONAL) bounded = true;
    if (name === "env") {
      const split = envSplitString(argv);
      if (split) {
        argv = split;
        continue;
      }
    }
    while (argv.length && argv[0].startsWith("-") && argv[0] !== "-") {
      const flag = argv.shift();
      if (flag === "--") break;
      if (valueFlags.includes(flag) && argv.length) argv.shift();
    }
    for (let n = WRAPPER_POSITIONAL[name] ?? 0; n > 0 && argv.length; n -= 1)
      argv.shift();
  }
  const cmd = new Command(argv, assigns);
  cmd.bounded = bounded;
  return cmd;
}

/**
 * The index of the `run` subcommand of a project runner, after its global
 * flags (`uv --directory x run`), or -1.
 * A word after a flag that `RUNNERS` does not know counts as the value of
 * that flag, so an unknown value flag cannot hide the `run`.
 */
function runIndex(argv) {
  const name = program(argv[0]);
  if (!Object.hasOwn(RUNNERS, name)) return -1;
  const valueFlags = RUNNERS[name];
  let k = 1;
  while (k < argv.length && argv[k].startsWith("-")) {
    const flag = argv[k];
    k += 1;
    if (
      !flag.includes("=") &&
      k < argv.length &&
      argv[k] !== "run" &&
      (valueFlags.includes(flag) || !argv[k].startsWith("-"))
    )
      k += 1;
  }
  if (name === "uv" && argv[k] === "tool" && argv[k + 1] === "run") k += 1;
  return argv[k] === "run" ? k : -1;
}

function envSplitString(argv) {
  for (let idx = 0; idx < argv.length; idx += 1) {
    const tok = argv[idx];
    // `-S 'cmd'`, `-S'cmd'`, `--split-string 'cmd'`, or `--split-string='cmd'`.
    const joined = /^(-S|--split-string=)(.+)$/.exec(tok)?.[2];
    const split =
      joined ??
      ((tok === "-S" || tok === "--split-string") && idx + 1 < argv.length
        ? argv[idx + 1]
        : undefined);
    if (split !== undefined) {
      try {
        return [
          ...tokenize(split).filter((t) => typeof t === "string"),
          ...argv.slice(joined === undefined ? idx + 2 : idx + 1),
        ];
      } catch {
        return undefined;
      }
    }
    if (!tok.startsWith("-")) return undefined;
  }
  return undefined;
}
