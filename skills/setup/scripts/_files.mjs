// File helpers for the setup scripts: backups that keep a bound,
// and a report of auto memory that does not load or is old.

import fs from "node:fs";
import path from "node:path";

/** The number of backups to keep for each file. */
export const KEEP_BACKUPS = 3;

/**
 * Copy `file` to `<file>.dotclaude-backup-<time>`, then delete the older backups of `file` past the newest `KEEP_BACKUPS`.
 * Returns the backup path and the deleted paths.
 * The time stamp sorts in time order as text.
 */
export function backup(file, now = new Date()) {
  const made = `${file}.dotclaude-backup-${now.toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(file, made);
  const prefix = `${path.basename(file)}.dotclaude-backup-`;
  const dir = path.dirname(file);
  const deleted = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .sort()
    .slice(0, -KEEP_BACKUPS)
    .map((f) => path.join(dir, f));
  for (const f of deleted) fs.rmSync(f);
  return { made, deleted };
}

// The official code intelligence plugins, by the language server that each needs on `PATH`.
// The `LSP` tool stays off until one of them is installed.
const LSP_PLUGINS = {
  "rust-analyzer": "rust-analyzer-lsp",
  "sourcekit-lsp": "swift-lsp",
  "typescript-language-server": "typescript-lsp",
  clangd: "clangd-lsp",
  "pyright-langserver": "pyright-lsp",
  gopls: "gopls-lsp",
};

/**
 * The LSP plugins whose language server `which` finds
 * and that `installed_plugins.json` (parsed) does not list.
 */
export function lspPlugins(which, installed) {
  const have = Object.keys(installed?.plugins ?? {}).map(
    (k) => k.split("@")[0],
  );
  return Object.entries(LSP_PLUGINS)
    .filter(([bin, name]) => which(bin) && !have.includes(name))
    .map(([, name]) => name);
}

// Claude Code loads the first 200 lines or 25 KB of `MEMORY.md`, whichever comes first.
// Topic files load only when Claude reads them.
const MEMORY_LINES = 200;
const MEMORY_BYTES = 25_000;
const OLD_DAYS = 30;

/**
 * The auto memory files under `<configDir>/projects/<project>/memory/` that need a look:
 * each `MEMORY.md` past the load bound, and each file not changed in `OLD_DAYS` days.
 * This reads only.
 * Memory is the user's data.
 */
export function memoryReport(configDir, now = Date.now()) {
  const root = path.join(configDir, "projects");
  const lines = [];
  let projects = [];
  try {
    projects = fs.readdirSync(root);
  } catch {
    return lines;
  }
  for (const project of projects) {
    const dir = path.join(root, project, "memory");
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      const stat = fs.statSync(file);
      const days = Math.floor((now - stat.mtimeMs) / 86_400_000);
      if (f === "MEMORY.md") {
        const count = fs.readFileSync(file, "utf8").split("\n").length;
        if (count > MEMORY_LINES || stat.size > MEMORY_BYTES)
          lines.push(
            `${file}: ${count} lines, ${stat.size} bytes. Only the first ${MEMORY_LINES} lines or ${MEMORY_BYTES} bytes load.`,
          );
      }
      if (days > OLD_DAYS) lines.push(`${file}: not changed in ${days} days.`);
    }
  }
  return lines;
}
