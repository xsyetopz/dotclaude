// Claude Code session scratchpads and loose temp entries left idle. Claude
// Code keeps them under $CLAUDE_CODE_TMPDIR (else /tmp) in claude-<uid>/, one
// folder per project and session, and never deletes them.

import fs from "node:fs";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;

export function tempRoot(env = process.env) {
  const base = env.CLAUDE_CODE_TMPDIR || "/tmp";
  return path.join(base, `claude-${process.getuid?.() ?? 0}`);
}

/** Newest mtime of a path and its entries, three levels deep. */
function newest(file, depth = 3) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return 0;
  }
  let latest = stat.mtimeMs;
  if (depth > 0 && stat.isDirectory()) {
    try {
      for (const name of fs.readdirSync(file))
        latest = Math.max(latest, newest(path.join(file, name), depth - 1));
    } catch {
      // unreadable: judge by the folder's own mtime
    }
  }
  return latest;
}

/**
 * Entries idle for `days`: session folders inside each project folder (whose
 * names start with "-"), and every other top-level entry. `keep` is a set of
 * session IDs never to prune.
 */
export function staleEntries(root, days, keep = new Set(), now = Date.now()) {
  const cutoff = now - days * DAY_MS;
  let top;
  try {
    top = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of top) {
    const entry = path.join(root, name);
    if (name.startsWith("-") && fs.lstatSync(entry).isDirectory()) {
      for (const session of fs.readdirSync(entry)) {
        if (keep.has(session)) continue;
        const dir = path.join(entry, session);
        if (newest(dir) < cutoff) out.push(dir);
      }
    } else if (newest(entry) < cutoff) out.push(entry);
  }
  return out;
}
