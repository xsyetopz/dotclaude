// Bash guard rules. `askFor(command, ctx)` gives one finding for each part of
// a command that needs the user's approval, as `{ part, reason }`.
// The tokenizer is small on purpose. It splits on `&&`, `||`, `;`, `|`, `&`,
// newlines, parentheses, and backticks, and it keeps quoted text in one word.
// It reads the script of `bash -c` and `sh -c` one level deep.

import { COMMAND_PART_CHARS } from "../budget.mjs";
import { TERMS } from "../terms.mjs";

const CODEGRAPH_CLAUSE = `This is clause ${TERMS.findIndex((t) => t.id === "codegraph-index") + 1} of the dotclaude Terms of Use.`;

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
    } else
      switch (c) {
        case "'":
        case '"':
          quote = c;
          word ??= "";
          break;
        case "\\":
          i += 1;
          word = (word ?? "") + (command[i] ?? "");
          break;
        case " ":
        case "\t":
          endWord();
          break;
        default:
          if (";|&\n()`".includes(c)) endPart();
          else word = (word ?? "") + c;
      }
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

/** The index of the git subcommand in `words`. */
function gitSub(words) {
  let i = 1;
  while (words[i]?.startsWith("-")) i += GIT_VALUE_FLAGS.has(words[i]) ? 2 : 1;
  return i;
}

/** True when a part of `command` is `git commit`. */
export function isCommit(command) {
  return partsOf(command).some((raw) => {
    let words = raw;
    while (
      /^[A-Za-z_]\w*=/.test(words[0] ?? "") ||
      WRAPPERS.has(base(words[0])) ||
      base(words[0]) === "sudo"
    )
      words = words.slice(1);
    return base(words[0]) === "git" && words[gitSub(words)] === "commit";
  });
}

const DISCARD =
  "This command discards the uncommitted changes in the named files, and git cannot restore them.";
// A word that names a file and not a branch: a path with an extension, a
// relative path, or a glob.
const PATH_LIKE = /(^\.{1,2}(\/|$)|\.[A-Za-z]\w*$|[*?])/;

/**
 * True when `git checkout <args>` overwrites files in the work tree: with
 * `--force`, with paths after `--`, with a ref and a path, or with one word
 * that looks like a path. A branch switch keeps uncommitted changes.
 */
function checkoutDiscards(args) {
  if (hasFlag(args, "--force", "f")) return true;
  const dash = args.indexOf("--");
  if (dash >= 0) return dash < args.length - 1;
  if (hasFlag(args, "--orphan", "bB")) return false;
  const words = args.filter((a) => !a.startsWith("-"));
  return words.length > 1 || PATH_LIKE.test(words[0] ?? "");
}

function gitReason(words) {
  const i = gitSub(words);
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
      if (checkoutDiscards(args)) return DISCARD;
      break;
    case "restore":
      if (
        args.some((a) => !a.startsWith("-")) &&
        !(hasFlag(args, "--staged", "S") && !hasFlag(args, "--worktree", "W"))
      )
        return DISCARD;
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
  switch (name) {
    case "git":
      return gitReason(words);
    case "rm":
      if (hasFlag(args, "--recursive", "rR")) return rmReason(args, ctx);
      break;
    case "dd":
      if (args.some((a) => a.startsWith("of=/dev/")))
        return "This command writes straight to a device.";
      break;
    case "chmod":
      if (
        hasFlag(args, "--recursive", "R") &&
        args.some((a) => /^(0?777|a\+rwx|ugo\+rwx)$/.test(a))
      )
        return "This command makes a whole tree writable for all users.";
      break;
    case "codegraph":
      switch (args[0]) {
        case "init":
          return `This command builds a CodeGraph index of the project in a \`.codegraph/\` folder. ${CODEGRAPH_CLAUSE}`;
        case "uninit":
          return `This command deletes the CodeGraph index of the project. ${CODEGRAPH_CLAUSE}`;
      }
      break;
  }
  if (name === "mkfs" || name.startsWith("mkfs."))
    return "This command erases the data of a device.";
  if (READERS.has(name) && args.some(isSecretFile))
    return "This command reads a file that can hold secrets.";
  return undefined;
}

// Each flagged target gets its own reason, because a harmless first target
// once hid a `"${TMPDIR}"tmp.*` target that deleted the temporary folders of other programs.
function rmReason(args, ctx) {
  const found = args
    .filter((a) => !a.startsWith("-"))
    .map((target) => [target, removeReason(target, ctx)])
    .filter(([, reason]) => reason);
  if (found.length < 2) return found[0]?.[1];
  return found.map(([target, reason]) => `\`${target}\`: ${reason}`).join(" ");
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
