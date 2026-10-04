// Bash guard rules. `askFor(command, ctx)` gives one finding for each part of
// a command that needs the user's approval, as `{ part, reason }`.
// The tokenizer is small on purpose. It splits on `&&`, `||`, `;`, `|`, `&`,
// newlines, parentheses, and backticks, and it keeps quoted text in one word.
// It reads the script of `bash -c` and `sh -c` one level deep.

import { COMMAND_PART_CHARS } from "./_budget.mjs";

/** The parts of `command`, each as a list of words. */
export function tokenize(command) {
  const parts = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endPart = () => {
    endWord();
    if (words.length) parts.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < command.length) {
        i += 1;
        word += command[i];
      } else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === "\\") {
      i += 1;
      word = (word ?? "") + (command[i] ?? "");
    } else if (c === " " || c === "\t") endWord();
    else if (";|&\n()`".includes(c)) endPart();
    else word = (word ?? "") + c;
  }
  endPart();
  return parts;
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);

/** The parts of `command`, with the script of each `sh -c` one level deep. */
function partsOf(command, depth = 0) {
  const out = [];
  for (const words of tokenize(command)) {
    out.push(words);
    const at = words.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w));
    const script = words[at + 1];
    if (depth === 0 && SHELLS.has(base(words[0])) && at > 0 && script)
      out.push(...partsOf(script, 1));
  }
  return out;
}

const base = (word = "") => word.split("/").pop();
const WRAPPERS = new Set(["env", "command", "nohup", "time", "exec"]);

/** True when `args` has the long flag, or a letter of `short` in a short group. */
function hasFlag(args, long, short = "") {
  return args.some(
    (a) =>
      a === long ||
      a.startsWith(`${long}=`) ||
      (/^-[^-]/.test(a) && [...short].some((c) => a.includes(c))),
  );
}

const GIT_VALUE_FLAGS = new Set(["-C", "-c", "--git-dir", "--work-tree"]);

function gitReason(words) {
  let i = 1;
  while (words[i]?.startsWith("-")) i += GIT_VALUE_FLAGS.has(words[i]) ? 2 : 1;
  const sub = words[i];
  const args = words.slice(i + 1);
  switch (sub) {
    case "push":
      if (
        hasFlag(args, "--force", "f") ||
        hasFlag(args, "--force-with-lease") ||
        hasFlag(args, "--force-if-includes") ||
        args.some((a) => a.startsWith("+"))
      )
        return "A forced push can replace commits on the remote.";
      break;
    case "reset":
      if (args.includes("--hard"))
        return "A hard reset removes all uncommitted changes.";
      break;
    case "clean":
      if (hasFlag(args, "--force", "f") && !hasFlag(args, "--dry-run", "n"))
        return "This command deletes untracked files for good.";
      break;
    case "checkout":
    case "restore":
      if (
        args.includes(".") &&
        !(
          sub === "restore" &&
          hasFlag(args, "--staged") &&
          !hasFlag(args, "--worktree")
        )
      )
        return "This command discards the changes in the work tree.";
      break;
    case "branch":
      if (args.some((a) => /^-[a-zA-Z]*D/.test(a)))
        return "This command deletes a branch even when it is not merged.";
      break;
    default:
  }
  return undefined;
}

/** The absolute path of `target`, with `.` and `..` resolved. */
function resolve(target, cwd) {
  const out = [];
  const full = target.startsWith("/") ? target : `${cwd}/${target}`;
  for (const part of full.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return `/${out.join("/")}`;
}

const inside = (path, root) => path === root || path.startsWith(`${root}/`);

/** The reason that `rm -r` of `target` needs approval, if it does. */
function removeReason(target, { project, cwd, home }) {
  const t = target.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home ?? "\0");
  if (t.startsWith("\0")) return "The home folder of the user is not known.";
  if (t.includes("$")) return "The target is known only at run time.";
  const path = resolve(t, cwd);
  if (path === "/") return "This command deletes the root folder.";
  if (path === home) return "This command deletes the home folder.";
  if (!project) return "The project folder is not known.";
  if (path === project) return "This command deletes the project folder.";
  if (!inside(path, project)) return "The target is outside the project.";
  return undefined;
}

const READERS = new Set(
  "cat less more head tail bat nl tac xxd od strings grep rg awk sed base64 cut sort diff".split(
    " ",
  ),
);
const SECRET_FILE = [
  /(^|\/)\.env(\.[\w.-]+)?$/,
  /(^|\/)\.ssh\/id_[\w-]+$/,
  /(^|\/)\.aws\/credentials$/,
];
const ENV_TEMPLATE = /\.(example|sample|template|dist)$/;

const isSecretFile = (word) =>
  SECRET_FILE.some((re) => re.test(word)) && !ENV_TEMPLATE.test(word);

/** The reason for one part, or undefined. `words` has no leading `sudo`. */
function reasonFor(words, ctx) {
  const name = base(words[0]);
  const args = words.slice(1);
  if (name === "git") return gitReason(words);
  if (name === "rm" && hasFlag(args, "--recursive", "rR"))
    return rmReason(args, ctx);
  if (name === "dd" && args.some((a) => a.startsWith("of=/dev/")))
    return "This command writes straight to a device.";
  if (name === "mkfs" || name.startsWith("mkfs."))
    return "This command erases the data of a device.";
  if (
    name === "chmod" &&
    hasFlag(args, "--recursive", "R") &&
    args.some((a) => /^(0?777|a\+rwx|ugo\+rwx)$/.test(a))
  )
    return "This command makes a whole tree writable for all users.";
  if (READERS.has(name) && args.some(isSecretFile))
    return "This command reads a file that can hold secrets.";
  return undefined;
}

function rmReason(args, ctx) {
  for (const target of args.filter((a) => !a.startsWith("-"))) {
    const reason = removeReason(target, ctx);
    if (reason) return reason;
  }
  return undefined;
}

/**
 * One finding for each part of `command` that needs approval. `ctx` holds
 * `project` (the project folder), `cwd`, and `home`.
 */
export function askFor(command, ctx) {
  const findings = [];
  for (const raw of partsOf(command)) {
    let words = raw;
    let sudo = false;
    for (;;) {
      while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) words = words.slice(1);
      if (WRAPPERS.has(base(words[0]))) words = words.slice(1);
      else if (base(words[0]) === "sudo") {
        sudo = true;
        words = words.slice(1);
      } else break;
    }
    if (!words.length) continue;
    const reason = sudo
      ? "This command runs as the root user."
      : reasonFor(words, ctx);
    if (reason) findings.push({ part: partText(raw), reason });
  }
  return findings;
}

const partText = (words) => {
  const text = words.join(" ");
  return text.length > COMMAND_PART_CHARS
    ? `${text.slice(0, COMMAND_PART_CHARS)}...`
    : text;
};
