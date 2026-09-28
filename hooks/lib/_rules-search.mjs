// Bash guard rule for recursive searches and listings that walk into
// gitignored directories (build output, dependencies, caches). A walk that
// does not read .gitignore can take minutes on a large build directory and
// floods the context with generated files.
//
// A walk is denied only when a directory it searches contains a gitignored
// directory that the command does not exclude. Walks of a directory without
// ignored content (`grep -r x src`), walks that start inside an ignored
// directory (a deliberate target such as `.build/debug`), and shallow walks
// pass.

import path from "node:path";
import { git, isUnder } from "./_bash-args.mjs";
import { resolveTarget } from "./_rules-filesystem.mjs";

// Walks this shallow list a few entries of an ignored directory at most.
const SHALLOW = 2;

/**
 * Split argv into flags and positionals. `short` lists single-letter flags
 * that take a value; `long` lists long flags that take a value.
 */
function parseArgs(args, short = "", long = []) {
  const flags = [];
  const positionals = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (afterDashDash || a === "-" || !a.startsWith("-")) {
      positionals.push(a);
    } else if (a === "--") {
      afterDashDash = true;
    } else if (a.startsWith("--")) {
      const [name, inline] = a.split(/=(.*)/s);
      if (inline !== undefined) flags.push([name, inline]);
      else if (long.includes(name)) {
        flags.push([name, args[i + 1] ?? ""]);
        i += 1;
      } else flags.push([name, undefined]);
    } else {
      // A short cluster: `-rn`, `-A3`, `-e pattern`.
      const letters = a.slice(1);
      for (let j = 0; j < letters.length; j += 1) {
        const ch = letters[j];
        if (short.includes(ch)) {
          const rest = letters.slice(j + 1);
          if (rest) flags.push([`-${ch}`, rest]);
          else {
            flags.push([`-${ch}`, args[i + 1] ?? ""]);
            i += 1;
          }
          break;
        }
        flags.push([`-${ch}`, undefined]);
      }
    }
  }
  return { flags, positionals };
}

const has = (flags, ...names) => flags.some(([f]) => names.includes(f));
const values = (flags, ...names) =>
  flags.filter(([f]) => names.includes(f)).map(([, v]) => v ?? "");
const count = (flags, name) => flags.filter(([f]) => f === name).length;

function depth(flags, ...names) {
  const v = values(flags, ...names).at(-1);
  return v === undefined ? undefined : Number.parseInt(v, 10);
}

/** `{a,b}` alternatives, as the shell expands them and rg and fd globs match them. */
function expandBraces(glob) {
  const m = /^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/s.exec(glob);
  if (!m) return [glob];
  return m[2].split(",").flatMap((alt) => expandBraces(m[1] + alt + m[3]));
}

/** Directory names from exclude globs such as `!.build`, `**\/node_modules/**`. */
function excludeNames(globs) {
  return globs.flatMap((g) =>
    g
      .split("|")
      .flatMap(expandBraces)
      .map((p) =>
        p
          .replace(/^!/, "")
          .replace(/^(\.\/|\*\*\/|\*\/|\/)+/, "")
          .replace(/(\/\*\*|\/\*|\/)+$/, ""),
      )
      .filter(Boolean),
  );
}

// Each walker returns {tool, roots, excludes, depth} for a walk that does not
// read .gitignore, or undefined when the command is not such a walk.

const GREP_SHORT = "efmABCdDX";
const GREP_LONG = [
  "--regexp",
  "--file",
  "--max-count",
  "--after-context",
  "--before-context",
  "--context",
  "--directories",
  "--devices",
  "--include",
  "--exclude",
  "--exclude-dir",
  "--exclude-from",
  "--label",
  "--binary-files",
];

function grep(cmd) {
  const { flags, positionals } = parseArgs(cmd.args, GREP_SHORT, GREP_LONG);
  const recursive =
    has(flags, "-r", "-R", "--recursive", "--dereference-recursive") ||
    values(flags, "-d", "--directories").includes("recurse");
  if (!recursive) return undefined;
  const patternGiven = has(flags, "-e", "--regexp", "-f", "--file");
  return {
    tool: `${cmd.name} -r`,
    roots: patternGiven ? positionals : positionals.slice(1),
    excludes: excludeNames(values(flags, "--exclude-dir")),
  };
}

const RG_SHORT = "efgtTmABCjMErd";
const RG_LONG = [
  "--regexp",
  "--file",
  "--glob",
  "--iglob",
  "--type",
  "--type-not",
  "--type-add",
  "--type-clear",
  "--max-count",
  "--after-context",
  "--before-context",
  "--context",
  "--threads",
  "--max-columns",
  "--encoding",
  "--replace",
  "--max-depth",
  "--maxdepth",
  "--max-filesize",
  "--ignore-file",
  "--colors",
  "--color",
  "--sort",
  "--sortr",
  "--path-separator",
  "--pre",
  "--pre-glob",
  "--context-separator",
  "--field-context-separator",
  "--field-match-separator",
  "--engine",
  "--dfa-size-limit",
  "--regex-size-limit",
];

function rg(cmd) {
  const { flags, positionals } = parseArgs(cmd.args, RG_SHORT, RG_LONG);
  if (
    !has(flags, "--no-ignore", "--no-ignore-vcs", "--no-ignore-parent") &&
    count(flags, "-u") === 0 &&
    !has(flags, "--unrestricted")
  )
    return undefined;
  const listing = has(flags, "--files", "--type-list");
  const patternGiven = has(flags, "-e", "--regexp", "-f", "--file");
  return {
    tool: "rg --no-ignore",
    roots: listing || patternGiven ? positionals : positionals.slice(1),
    excludes: excludeNames(
      values(flags, "-g", "--glob", "--iglob").filter((g) => g.startsWith("!")),
    ),
    depth: depth(flags, "-d", "--max-depth", "--maxdepth"),
  };
}

const FD_SHORT = "etEdScjxX";
const FD_LONG = [
  "--extension",
  "--type",
  "--exclude",
  "--max-depth",
  "--min-depth",
  "--exact-depth",
  "--size",
  "--changed-within",
  "--changed-before",
  "--owner",
  "--threads",
  "--color",
  "--search-path",
  "--base-directory",
  "--ignore-file",
  "--max-results",
  "--path-separator",
  "--format",
  "--batch-size",
  "--exec",
  "--exec-batch",
];

function fdWalk(cmd) {
  // Everything after -x/-X is the command fd runs, not fd's own arguments.
  const execAt = cmd.args.findIndex((a) =>
    ["-x", "--exec", "-X", "--exec-batch"].includes(a),
  );
  const own = execAt === -1 ? cmd.args : cmd.args.slice(0, execAt);
  const { flags, positionals } = parseArgs(own, FD_SHORT, FD_LONG);
  if (
    !has(flags, "-I", "--no-ignore", "--no-ignore-vcs", "-u", "--unrestricted")
  )
    return undefined;
  const base = values(flags, "--base-directory").at(-1);
  let roots = [...positionals.slice(1), ...values(flags, "--search-path")];
  if (base)
    roots = roots.length ? roots.map((r) => path.join(base, r)) : [base];
  return {
    tool: `${cmd.name} --no-ignore`,
    roots,
    excludes: excludeNames(values(flags, "-E", "--exclude")),
    depth: depth(flags, "-d", "--max-depth", "--exact-depth"),
  };
}

function find(cmd) {
  const args = cmd.args;
  let i = 0;
  while (["-H", "-L", "-P"].includes(args[i]) || /^-O\d$/.test(args[i] ?? ""))
    i += 1;
  const roots = [];
  while (i < args.length && !/^[-(!]/.test(args[i])) roots.push(args[i++]);
  const expr = args.slice(i);
  const at = (name) => {
    const k = expr.lastIndexOf(name);
    return k === -1 ? undefined : expr[k + 1];
  };
  // Only -prune stops find from descending; `-not -path` filters output after
  // the walk.
  const excludes = expr.includes("-prune")
    ? excludeNames(
        expr.flatMap((a, k) =>
          ["-name", "-iname", "-path", "-ipath", "-wholename"].includes(a) &&
          expr[k + 1]
            ? [expr[k + 1]]
            : [],
        ),
      )
    : [];
  const maxdepth = at("-maxdepth");
  return {
    tool: "find",
    roots,
    excludes,
    depth:
      maxdepth === undefined || !/^\d+$/.test(maxdepth)
        ? undefined
        : Number(maxdepth),
  };
}

function tree(cmd) {
  const { flags, positionals } = parseArgs(cmd.args, "LIPo", [
    "--filelimit",
    "--timefmt",
    "--sort",
    "--charset",
  ]);
  if (has(flags, "--gitignore")) return undefined;
  return {
    tool: "tree",
    roots: positionals,
    excludes: excludeNames(values(flags, "-I")),
    depth: depth(flags, "-L"),
  };
}

function ls(cmd) {
  const { flags, positionals } = parseArgs(cmd.args, "Iw", [
    "--ignore",
    "--hide",
    "--width",
    "--format",
    "--sort",
    "--time",
    "--time-style",
    "--color",
    "--block-size",
    "--quoting-style",
    "--indicator-style",
  ]);
  if (!has(flags, "-R", "--recursive")) return undefined;
  return {
    tool: "ls -R",
    roots: positionals,
    excludes: excludeNames(values(flags, "-I", "--ignore", "--hide")),
  };
}

function ack(cmd) {
  const { flags, positionals } = parseArgs(cmd.args, "ABCmg", [
    "--ignore-dir",
    "--ignore-directory",
    "--noignore-dir",
    "--type",
    "--match",
    "--max-count",
    "--context",
    "--after-context",
    "--before-context",
  ]);
  const listing = has(flags, "-f", "-g", "--match");
  return {
    tool: cmd.name,
    roots: listing ? positionals : positionals.slice(1),
    excludes: excludeNames(values(flags, "--ignore-dir", "--ignore-directory")),
  };
}

function ag(cmd) {
  const { flags, positionals } = parseArgs(cmd.args, "ABCGmgp", [
    "--ignore",
    "--ignore-dir",
    "--depth",
    "--file-search-regex",
    "--max-count",
    "--context",
    "--after-context",
    "--before-context",
    "--path-to-ignore",
    "--pager",
    "--workers",
  ]);
  if (!has(flags, "-u", "--unrestricted", "-U", "--skip-vcs-ignores"))
    return undefined;
  const listing = has(flags, "-g");
  return {
    tool: `${cmd.name} -u`,
    roots: listing ? positionals : positionals.slice(1),
    excludes: excludeNames(values(flags, "--ignore", "--ignore-dir")),
    depth: depth(flags, "--depth"),
  };
}

function gitGrep(cmd) {
  // Skip git's global options (`git -C dir grep`).
  let i = 0;
  while (i < cmd.args.length && cmd.args[i].startsWith("-"))
    i += ["-C", "-c", "--git-dir", "--work-tree"].includes(cmd.args[i]) ? 2 : 1;
  if (cmd.args[i] !== "grep") return undefined;
  const { flags, positionals } = parseArgs(cmd.args.slice(i + 1), "efmABCO", [
    "--regexp",
    "--file",
    "--max-count",
    "--after-context",
    "--before-context",
    "--context",
    "--max-depth",
    "--threads",
    "--open-files-in-pager",
  ]);
  const noIndex = has(flags, "--no-index") && !has(flags, "--exclude-standard");
  const untracked =
    has(flags, "--untracked") && has(flags, "--no-exclude-standard");
  if (!noIndex && !untracked) return undefined;
  const patternGiven = has(flags, "-e", "--regexp", "-f", "--file");
  return {
    tool: "git grep --no-index",
    roots: patternGiven ? positionals : positionals.slice(1),
    excludes: [],
    depth: depth(flags, "--max-depth"),
  };
}

const WALKERS = {
  grep,
  egrep: grep,
  fgrep: grep,
  ggrep: grep,
  rg,
  fd: fdWalk,
  fdfind: fdWalk,
  find,
  gfind: find,
  tree,
  ls,
  gls: ls,
  ack,
  "ack-grep": ack,
  ag,
  git: gitGrep,
};

/** Gitignored directories (relative to the repo root) under `dir`. */
function ignoredDirs(dir, ctx) {
  // Under the project: ask about that directory. Above it: the whole project.
  let scope;
  if (isUnder(dir, ctx.root)) scope = dir;
  else if (isUnder(ctx.root, dir)) scope = ctx.root;
  else return [];
  const rel = path.relative(ctx.root, scope) || ".";
  if (
    rel !== "." &&
    git(ctx.root, ["check-ignore", "-q", "--", rel]) !== undefined
  )
    return [];
  const out = git(ctx.root, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "--",
    rel,
  ]);
  if (!out) return [];
  return out
    .split("\0")
    .filter((p) => p.endsWith("/"))
    .map((p) => p.slice(0, -1));
}

function excluded(dir, excludes) {
  return excludes.some(
    (e) => e === dir || e === path.basename(dir) || dir.endsWith(`/${e}`),
  );
}

export function ignoredWalk(cmd, ctx) {
  const walker = Object.hasOwn(WALKERS, cmd.name) ? WALKERS[cmd.name] : null;
  const walk = walker?.(cmd);
  if (!walk) return [];
  if (walk.depth !== undefined && walk.depth <= SHALLOW) return [];
  const roots = walk.roots.length ? walk.roots : ["."];
  const hits = new Set();
  for (const root of roots) {
    const dir = resolveTarget(root, cmd, ctx);
    if (!dir) continue;
    for (const d of ignoredDirs(dir, ctx))
      if (!excluded(d, walk.excludes)) hits.add(d);
  }
  if (!hits.size) return [];
  const list = [...hits];
  const shown = list
    .slice(0, 3)
    .map((d) => `\`${d}/\``)
    .join(", ");
  const more = list.length > 3 ? ` and ${list.length - 3} more` : "";
  return [
    [
      "deny",
      `\`${walk.tool}\` does not skip gitignored directories and would walk ${shown}${more} (build output, dependencies, or caches). Use \`rg\`, \`fd\`, or \`git grep\` without ignore-bypass flags, which skip them; exclude those directories; or name the directories to search`,
    ],
  ];
}
