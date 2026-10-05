#!/usr/bin/env bun
// Merge profiles/recommended.json into a Claude Code settings file, and remove
// CodeGraph's `prompt-hook` entry.
//
//   bun settings.mjs [--scope user|project|local] [--profile file] [--plan id] [--status-line] [--apply]
//
// The profile's `plans` object holds per-plan overrides, by plan id (see
// `hooks/lib/_plan.mjs`). They merge over the base values. The script detects
// the plan from the account in `.claude.json`, and `--plan` overrides that.
//
// A status line command gets an empty `${CLAUDE_PLUGIN_ROOT}`, so --apply also
// writes two stubs in `<config dir>/dotclaude/` that import this plugin's
// `status-line/main.mjs` and `subagents.mjs`, and sets `statusLine` and
// `subagentStatusLine` to run them. A stub finds the newest version in the
// plugin cache when it runs, so a plugin update needs no new stubs.
// A status line of another tool stays, unless `--status-line` is given.
//
// Without --apply, it prints what differs and writes nothing. That is also the
// status. With --apply, it backs the file up next to itself, keeps the newest
// three backups, then writes. It also reports auto memory to review.
// Merge rules: objects merge key by key, arrays gain missing entries, and
// scalars take the profile value. `availableModels` is replaced, because the
// profile owns the model list. The script also reports a CodeGraph MCP entry
// in `.claude.json`, which the skill removes with `claude mcp remove`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accountFrom,
  claudeJsonPath,
  detectPlan,
  PLANS,
  planLabel,
} from "../../../hooks/lib/_plan.mjs";
import { backup, lspPlugins, memoryReport } from "./_files.mjs";

/** The plan from the environment and the account in `.claude.json`. */
function localPlan(env = { HOME: os.homedir(), ...process.env }) {
  let text = "";
  try {
    text = fs.readFileSync(claudeJsonPath(env), "utf8");
  } catch {}
  return detectPlan(env, accountFrom(text));
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const scope = flag("--scope", "user");
const profilePath = path.resolve(
  flag(
    "--profile",
    path.join(import.meta.dirname, "..", "profiles", "recommended.json"),
  ),
);
const apply = args.includes("--apply");
const replaceStatusLine = args.includes("--status-line");
const planFlag = flag("--plan");
if (planFlag && !PLANS.includes(planFlag)) {
  console.error(`Unknown plan "${planFlag}". Use ${PLANS.join(", ")}.`);
  process.exit(2);
}
const configDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const targets = {
  user: path.join(configDir, "settings.json"),
  project: path.join(projectDir, ".claude", "settings.json"),
  local: path.join(projectDir, ".claude", "settings.local.json"),
};
if (!Object.hasOwn(targets, scope)) {
  console.error(`Unknown scope "${scope}". Use user, project, or local.`);
  process.exit(2);
}
const target = targets[scope];
// These arrays take the profile's entries instead of gaining them.
const REPLACED = new Set(["availableModels"]);

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(
      `${file} is not valid JSON (${err.message}). Nothing changed.`,
    );
    process.exit(1);
  }
}

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const show = (v) => (v === undefined ? "(unset)" : JSON.stringify(v));
const changes = [];

function merge(current, profile, keyPath) {
  const out = isObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(profile)) {
    const where = keyPath ? `${keyPath}.${key}` : key;
    const existing = out[key];
    if (isObject(value)) {
      out[key] = merge(existing, value, where);
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
  return out;
}

const isCodegraphHook = (hook) =>
  /codegraph\b.*\bprompt-hook/.test(String(hook?.command ?? ""));

/** Drop CodeGraph's `prompt-hook` from `hooks`, and any group left empty. */
function removeCodegraphHook(settings) {
  const groups = settings.hooks?.UserPromptSubmit;
  if (!Array.isArray(groups)) return settings;
  const kept = [];
  for (const group of groups) {
    const hooks = (group.hooks ?? []).filter((h) => !isCodegraphHook(h));
    if (hooks.length < (group.hooks ?? []).length)
      changes.push(
        "hooks.UserPromptSubmit: remove the CodeGraph `prompt-hook` entry",
      );
    if (hooks.length) kept.push({ ...group, hooks });
  }
  const { UserPromptSubmit: _, ...otherEvents } = settings.hooks;
  const hooks = kept.length
    ? { ...otherEvents, UserPromptSubmit: kept }
    : otherEvents;
  const { hooks: __, ...rest } = settings;
  return Object.keys(hooks).length ? { ...rest, hooks } : rest;
}

const STUB_DIR = path.join(configDir, "dotclaude");
const STATUS_LINES = [
  [
    "statusLine",
    "statusline.mjs",
    "main.mjs",
    { padding: 0, refreshInterval: 1 },
  ],
  ["subagentStatusLine", "subagent-statusline.mjs", "subagents.mjs", {}],
].map(([key, stub, script, extra]) => ({
  key,
  stub: path.join(STUB_DIR, stub),
  script: path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "status-line",
    script,
  ),
  setting: {
    type: "command",
    command: `bun ${JSON.stringify(path.join(STUB_DIR, stub))}`,
    ...extra,
  },
}));

/**
 * A stub's text. In the plugin cache, each version has a folder, so the stub
 * runs the script of the newest version that Claude Code did not orphan.
 * Then a plugin update takes effect without setup. Elsewhere (a checkout),
 * it runs the script of this plugin. It prints nothing when the plugin is gone.
 */
function stubText(script) {
  const root = path.resolve(path.dirname(script), "..");
  const versions = /^\d+\.\d+\.\d+$/.test(path.basename(root))
    ? path.dirname(root)
    : null;
  const rel = path.relative(root, script).replaceAll("\\", "/");
  return `// Managed by dotclaude. It runs the newest installed plugin version.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const versions = ${JSON.stringify(versions)};
let script = ${JSON.stringify(script)};
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

const profileFile = readJson(profilePath, null);
if (!isObject(profileFile)) {
  console.error(`Profile ${profilePath} not found or not an object.`);
  process.exit(1);
}
const plan = planFlag ?? localPlan();
const { plans, ...base } = profileFile;

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
const profile = overlay(base, isObject(plans?.[plan]) ? plans[plan] : {});
const current = readJson(target, {});
// A status line whose command does not run a dotclaude stub belongs to another tool.
const foreign = STATUS_LINES.filter(
  (l) =>
    !replaceStatusLine &&
    isObject(current[l.key]) &&
    !String(current[l.key].command ?? "").includes(STUB_DIR),
);
const ours = STATUS_LINES.filter((l) => !foreign.includes(l));
const merged = removeCodegraphHook(
  merge(
    current,
    {
      ...profile,
      ...Object.fromEntries(ours.map((l) => [l.key, l.setting])),
    },
    "",
  ),
);
const staleStubs = ours.filter((l) => {
  const text = stubText(l.script);
  const had = fs.existsSync(l.stub) && fs.readFileSync(l.stub, "utf8") === text;
  if (!had) changes.push(`write ${l.stub}`);
  return !had;
});

const claudeJson = process.env.CLAUDE_CONFIG_DIR
  ? path.join(configDir, ".claude.json")
  : path.join(os.homedir(), ".claude.json");
const mcp = readJson(claudeJson, {}).mcpServers;
const codegraphMcp = isObject(mcp) && Object.hasOwn(mcp, "codegraph");

console.log(`Target: ${target} (${scope} scope)`);
console.log(
  `Plan: ${planLabel(plan)} (${plan}, ${planFlag ? "from --plan" : "detected"})`,
);
console.log(
  changes.length
    ? `${changes.length} change(s):`
    : "Settings match the profile.",
);
for (const line of changes) console.log(`  ${line}`);
for (const l of foreign)
  console.log(
    `Kept your ${l.key}: ${current[l.key].command}. Run again with --status-line to use the dotclaude status line.`,
  );
if (codegraphMcp)
  console.log(
    `CodeGraph MCP entry found in ${claudeJson}. Remove it with: claude mcp remove codegraph -s user`,
  );
const lsp = lspPlugins(
  (bin) => Bun.which(bin),
  readJson(path.join(configDir, "plugins", "installed_plugins.json"), {}),
);
if (lsp.length) {
  console.log(
    "\nLanguage servers on PATH with no LSP plugin. Install each with:",
  );
  for (const name of lsp)
    console.log(`  /plugin install ${name}@claude-plugins-official`);
}
const memory = memoryReport(configDir);
if (memory.length) {
  console.log(
    "\nAuto memory to review (setup deletes no memory, the user decides):",
  );
  for (const line of memory) console.log(`  ${line}`);
}
if (!changes.length || !apply) {
  if (changes.length)
    console.log("\nDry run. Run again with --apply to write these changes.");
  process.exit(0);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) {
  const { made, deleted } = backup(target);
  console.log(`\nBackup: ${made}`);
  for (const f of deleted) console.log(`Deleted old backup: ${f}`);
}
for (const l of staleStubs) {
  fs.mkdirSync(STUB_DIR, { recursive: true });
  fs.writeFileSync(l.stub, stubText(l.script));
}
fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`);
console.log(
  `Wrote ${target}. Restart Claude Code for env and model settings to take effect.`,
);
