// Interpreters whose inline code the Bash guard reads, and the place where a
// command gives that code.
// The guard rules and the write scan use this one list, so that a versioned
// name such as `python3.12` gets the same checks in both.

const NAME = /^(python[0-9.]*|node|bun|deno|perl|ruby|php|osascript)$/;

/** The language of a program name (`python3.12` is `python`), or undefined. */
export function language(name) {
  if (!NAME.test(name)) return undefined;
  return name.startsWith("python") ? "python" : name;
}

// For each language: the flags whose value is code, the flags whose value is
// not code, and the last letter of a flag cluster whose value is code
// (`perl -ne`).
const FLAGS = {
  python: { code: ["-c"], value: ["-W", "-X", "-Q"], cluster: "c" },
  node: {
    code: ["-e", "--eval", "-p", "--print"],
    value: ["-r", "--require", "--import", "--loader", "-C", "--input-type"],
    cluster: "ep",
  },
  bun: {
    code: ["-e", "--eval", "-p", "--print"],
    value: ["-r", "--require", "--preload", "--cwd", "--env-file"],
  },
  deno: { code: [], value: [] },
  perl: { code: ["-e", "-E"], value: ["-I", "-M", "-m"], cluster: "eE" },
  ruby: { code: ["-e"], value: ["-r", "-I", "-C", "-E"], cluster: "e" },
  php: { code: ["-r"], value: ["-d", "-c"] },
  osascript: { code: ["-e"], value: ["-l"] },
};

/**
 * The inline code of an interpreter command: the values of its code flags,
 * or the code that it reads on stdin from a heredoc or from a piped `cat`
 * heredoc.
 * Undefined when the command runs a script file or a module.
 */
export function inlineCode(cmd) {
  const lang = language(cmd.name);
  if (!lang) return undefined;
  const { code, value, cluster } = FLAGS[lang];
  const args = cmd.args;
  const found = [];
  let stdin = true;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0 && code.includes(a.slice(0, eq))) {
      found.push(a.slice(eq + 1));
    } else if (code.includes(a)) {
      found.push(args[i + 1] ?? "");
      i += 1;
    } else if (value.includes(a)) {
      i += 1;
    } else if (
      cluster &&
      /^-[A-Za-z]+$/.test(a) &&
      cluster.includes(a.at(-1))
    ) {
      found.push(args[i + 1] ?? "");
      i += 1;
    } else if (a === "-" || a === "--") {
      break;
    } else if (lang === "python" && a === "-m") {
      stdin = false;
      break;
    } else if (lang === "deno" && a === "eval") {
      found.push(args[i + 1] ?? "");
      break;
    } else if (!a.startsWith("-")) {
      // A script file: later arguments go to the script.
      stdin = false;
      break;
    }
  }
  if (found.length) return found.join("\n");
  if (!stdin) return undefined;
  return cmd.heredoc ?? cmd.pipedInput ?? undefined;
}
