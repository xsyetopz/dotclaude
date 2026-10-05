// The difference between the settings of the user and the setup profile.
// `skills/setup/scripts/settings.mjs` and `claude-md.mjs` write with it, and
// the SessionStart hook uses it to tell the user that the setup is stale.

import path from "node:path";

export const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const show = (v) => (v === undefined ? "(unset)" : JSON.stringify(v));

// These arrays take the profile's entries instead of gaining them.
const REPLACED = new Set(["availableModels"]);

/** `over` laid over `under`: objects merge, other values come from `over`. */
const overlay = (under, over) =>
  Object.fromEntries(
    [...new Set([...Object.keys(under), ...Object.keys(over)])].map((key) => [
      key,
      isObject(under[key]) && isObject(over[key])
        ? overlay(under[key], over[key])
        : (over[key] ?? under[key]),
    ]),
  );

/**
 * The profile for `plan`: the `plans` entry of the plan merges over the base
 * values of the profile file.
 */
export function profileFor(profileFile, plan) {
  const { plans, ...base } = profileFile;
  return overlay(base, isObject(plans?.[plan]) ? plans[plan] : {});
}

/**
 * `profile` merged into `current`, and one line for each change.
 * Objects merge key by key, arrays gain missing entries, and scalars take the
 * profile value.
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

const BEGIN = "<!-- dotclaude:begin (managed by /dotclaude:setup) -->";
const END = "<!-- dotclaude:end -->";
const BLOCK = /<!-- dotclaude:begin[^\n]*-->[\s\S]*?<!-- dotclaude:end -->\n?/;

// The CodeGraph section of `codegraph install`. The block has its own
// CodeGraph rule, so setup removes this section.
const CODEGRAPH_SECTION =
  /<!-- CODEGRAPH_START -->[\s\S]*?<!-- CODEGRAPH_END -->\n*/;

/**
 * `current` (a `CLAUDE.md` text) with the dotclaude block of `body`, and
 * without the CodeGraph section. `legacy` is true when the section was there.
 */
export function withClaudeMdBlock(current, body) {
  const block = `${BEGIN}\n${body.trimEnd()}\n${END}\n`;
  const legacy = CODEGRAPH_SECTION.test(current);
  const rest = current.replace(CODEGRAPH_SECTION, "");
  const text = BLOCK.test(rest)
    ? rest.replace(BLOCK, block)
    : `${rest}${rest && !rest.endsWith("\n\n") ? "\n" : ""}${block}`;
  return { block, text, legacy };
}

/**
 * The status line launchers: the settings key, the launcher file in
 * `<config dir>/dotclaude/`, and the script in `status-line/` that it runs.
 */
export const LAUNCHERS = [
  ["statusLine", "statusline.mjs", "main.mjs"],
  ["subagentStatusLine", "subagent-statusline.mjs", "subagents.mjs"],
];

/**
 * The text of a launcher for `script`. A status line command gets an empty
 * `${CLAUDE_PLUGIN_ROOT}`, so the launcher finds the plugin itself. In the
 * plugin cache, each version has a folder, and the launcher runs the script
 * of the newest version that Claude Code did not orphan. Then a plugin update
 * takes effect without setup, and the text does not change with the version.
 * Elsewhere (a checkout), it runs `script`. It prints nothing when the plugin
 * is gone.
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

/**
 * The note to the user when the setup differs from the profile of plugin
 * `version`, or null. `changes` are the settings changes, `claudeMd` is
 * true when the `CLAUDE.md` block is stale, and `launchers` is the number of
 * status line launchers that are missing or out of date.
 */
export function staleSetupNote(version, changes, claudeMd, launchers = 0) {
  const parts = [];
  if (changes.length)
    parts.push(`${changes.length} setting${changes.length === 1 ? "" : "s"}`);
  if (claudeMd) parts.push("the `CLAUDE.md` block");
  if (launchers)
    parts.push(
      `${launchers} status line launcher${launchers === 1 ? "" : "s"}`,
    );
  if (!parts.length) return null;
  return `dotclaude ${version}: your setup differs from the profile in ${parts.join(" and ")}. Run /dotclaude:setup to see and apply the changes.`;
}
