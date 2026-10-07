// The helpers of `skills/setup/scripts/settings.mjs`:
// the merge of the profile into a settings file, the backups, the status line launcher,
// and the LSP plugins to enable.

import fs from "node:fs";
import path from "node:path";

export const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const show = (v) => (v === undefined ? "(unset)" : JSON.stringify(v));

// These arrays take the entries of the profile, and do not gain them.
const REPLACED = new Set(["availableModels"]);

/**
 * `profile` merged into `current`, and one line for each change.
 * Objects merge key by key, arrays gain the missing entries, and scalars take the profile value.
 */
export function mergeProfile(current, profile, keyPath = "", changes = []) {
  const out = isObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(profile)) {
    const where = keyPath ? `${keyPath}.${key}` : key;
    const existing = out[key];
    if (isObject(value)) {
      out[key] = mergeProfile(existing, value, where, changes).settings;
    } else if (Array.isArray(value)) {
      const had = Array.isArray(existing) ? existing : [];
      const next = REPLACED.has(where)
        ? value
        : [...had, ...value.filter((v) => !had.includes(v))];
      if (JSON.stringify(had) !== JSON.stringify(next))
        changes.push(`${where}: ${show(existing)} -> ${show(next)}`);
      out[key] = next;
    } else if (JSON.stringify(existing) !== JSON.stringify(value)) {
      changes.push(`${where}: ${show(existing)} -> ${show(value)}`);
      out[key] = value;
    }
  }
  return { settings: out, changes };
}

/**
 * The keys that dotclaude 0.26 wrote and that work against this profile, with the value that 0.26 wrote.
 * `includeGitInstructions: false` removes the git steps that the `attribution` setting needs,
 * and `autoCompactWindow` has no use with compaction off.
 * `advisorModel` turns on the advisor tool, which adds its instructions to each request
 * and reads the whole context without the cache on each call.
 */
export const LEGACY = [
  ["includeGitInstructions", false],
  ["autoCompactWindow", 150000],
  ["advisorModel", "claude-opus-5-5"],
];

/** `settings` without the `LEGACY` keys that still hold the 0.26 value, and one line for each removal. */
export function dropLegacy(settings, changes = []) {
  const out = { ...settings };
  for (const [key, value] of LEGACY) {
    if (out[key] !== value) continue;
    changes.push(`${key}: ${show(value)} -> (unset)`);
    delete out[key];
  }
  return out;
}

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

/** The `CLAUDE.md` block that dotclaude 0.26 wrote. */
export const CLAUDE_MD_BLOCK =
  /<!-- dotclaude:begin[^\n]*-->[\s\S]*?<!-- dotclaude:end -->\n?/;

/**
 * The text of a launcher for `script`.
 * A status line command gets an empty `${CLAUDE_PLUGIN_ROOT}`, so the launcher finds the plugin itself.
 * In the plugin cache, each version has a folder,
 * and the launcher runs the script of the newest version that Claude Code did not orphan.
 * Then a plugin update takes effect without setup, and the text does not change with the version.
 * Elsewhere (a checkout), it runs `script`.
 * It prints nothing when the plugin is gone.
 */
export function launcherText(script) {
  const root = path.resolve(path.dirname(script), "..");
  const versions = /^\d+\.\d+\.\d+$/.test(path.basename(root))
    ? path.dirname(root)
    : null;
  const rel = path.relative(root, script).replaceAll("\\", "/");
  return `// Managed by dotclaude. It runs the newest installed plugin version.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const versions = ${JSON.stringify(versions)};
let script = ${JSON.stringify(versions ? null : script)};
try {
  const newest = fs
    .readdirSync(versions)
    .filter((v) => /^\\d+\\.\\d+\\.\\d+$/.test(v))
    .filter((v) => !fs.existsSync(\`\${versions}/\${v}/.orphaned_at\`))
    .filter((v) => fs.existsSync(\`\${versions}/\${v}/${rel}\`))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .pop();
  if (newest) script = \`\${versions}/\${newest}/${rel}\`;
} catch {}
try {
  await import(pathToFileURL(script).href);
} catch {}
`;
}

// The official marketplace lists its code intelligence plugins with the `lspServers` that each runs.
// The `LSP` tool stays off until one of them is enabled.
const OFFICIAL = "claude-plugins-official";

/**
 * The commands to type for the official LSP plugins whose language servers `which` all finds
 * and that the user has not enabled.
 * `marketplace` is the parsed marketplace manifest, `installed` is the parsed `installed_plugins.json`,
 * and `enabled` is `enabledPlugins` of the user settings.
 */
export function lspPlugins(which, marketplace, installed, enabled) {
  return (marketplace?.plugins ?? [])
    .filter((p) => {
      const servers = Object.values(p.lspServers ?? {});
      const key = `${p.name}@${OFFICIAL}`;
      return (
        servers.length &&
        servers.every((s) => which(s.command)) &&
        enabled?.[key] !== true
      );
    })
    .map((p) =>
      Object.hasOwn(installed?.plugins ?? {}, `${p.name}@${OFFICIAL}`)
        ? `/plugin enable ${p.name}@${OFFICIAL}`
        : `/plugin install ${p.name}@${OFFICIAL}`,
    );
}

/** The lowest OpenSpec version that the dotclaude docs describe. */
export const OPENSPEC_MIN = "1.14.0";

/** True when version text `a` is lower than `b`. */
export const olderThan = (a, b) =>
  String(a).localeCompare(b, "en", { numeric: true }) < 0;
