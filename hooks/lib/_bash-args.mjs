// Argument helpers shared by the Bash guard rules.

import { execFileSync } from "node:child_process";
import path from "node:path";

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

export function isUnder(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}
