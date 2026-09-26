// One simple command after `VAR=` prefixes and wrappers such as sudo, env,
// timeout, and xargs are stripped.

import path from "node:path";
import { tokenize } from "./_shell-lexer.mjs";

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Normalize `/usr/bin/rm`, `\rm` to `rm`. */
export function program(token) {
  return path.basename(token.replace(/^\\+/, ""));
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
};

const WRAPPER_POSITIONAL = { timeout: 1, gtimeout: 1 };

class Command {
  constructor(argv, assigns) {
    this.argv = argv;
    this.assigns = assigns;
    this.pipedFrom = null;
    this.heredoc = null;
    this.cwdHint = null;
    this.writes = [];
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
  while (argv.length) {
    while (argv.length && RESERVED.has(argv[0])) argv.shift();
    while (argv.length && ASSIGN.test(argv[0])) {
      const [key, ...rest] = argv.shift().split("=");
      assigns[key] = rest.join("=");
    }
    if (!argv.length) break;
    const name = program(argv[0]);
    if (!Object.hasOwn(WRAPPERS, name)) break;
    const valueFlags = WRAPPERS[name];
    argv.shift();
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
  return new Command(argv, assigns);
}

function envSplitString(argv) {
  for (let idx = 0; idx < argv.length; idx += 1) {
    const tok = argv[idx];
    if ((tok === "-S" || tok === "--split-string") && idx + 1 < argv.length) {
      try {
        return [
          ...tokenize(argv[idx + 1]).filter((t) => typeof t === "string"),
          ...argv.slice(idx + 2),
        ];
      } catch {
        return null;
      }
    }
    if (!tok.startsWith("-")) return null;
  }
  return null;
}
