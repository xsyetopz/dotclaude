// Argument helpers shared by the Bash guard rules.

// --- helpers ----------------------------------------------------------------

export function isFlagCluster(arg) {
  return arg.startsWith("-") && !arg.startsWith("--") && arg.length > 1;
}

export function hasFlag(args, longFlags = [], short = "") {
  for (const a of args) {
    if (a === "--") return false;
    if (
      longFlags.includes(a) ||
      longFlags.some((f) => f.startsWith("--") && a.startsWith(`${f}=`))
    )
      return true;
    if (
      short &&
      isFlagCluster(a) &&
      [...a.slice(1)].some((ch) => short.includes(ch))
    )
      return true;
  }
  return false;
}

export function targets(args) {
  const out = [];
  let afterDashDash = false;
  for (const a of args) {
    if (a === "--" && !afterDashDash) {
      afterDashDash = true;
    } else if (afterDashDash || !a.startsWith("-")) {
      out.push(a);
    }
  }
  return out;
}

export function positional(args) {
  return args.filter((a) => !a.startsWith("-"));
}

/** `path` is the path module of the caller, so the rule matches its platform. */
export function isUnder(child, parent, path) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// The old `execFileSync` stopped at 1 MiB of output, so `git()` does the same.
const GIT_MAX_BYTES = 1024 * 1024;

/** The stdout of `git -C cwd ...args`, or undefined when git fails. */
export async function git(io, cwd, args) {
  try {
    const r = await io.run(["git", "-C", cwd, ...args], {
      timeoutMs: 3000,
      maxBytes: GIT_MAX_BYTES,
    });
    return r.exitCode === 0 ? r.stdout : undefined;
  } catch {
    return undefined;
  }
}
