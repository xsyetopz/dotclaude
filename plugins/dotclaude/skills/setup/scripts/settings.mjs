#!/usr/bin/env bun
// Merge templates/settings.json into a Claude Code settings file, and remove
// CodeGraph's `prompt-hook` entry.
//
//   bun settings.mjs [--scope user|project|local] [--profile file] [--plan id] [--status-line] [--apply]
//
// The profile's `plans` object holds per-plan overrides, by plan id (see
// `lib/plan.mjs`). They merge over the base values. The script detects
// the plan from the account in `.claude.json`, and `--plan` overrides that.
//
// --apply also writes two stubs in `<config dir>/dotclaude/` that import this
// plugin's `status-line/main.mjs` and `subagents.mjs`, and sets `statusLine`
// and `subagentStatusLine` to run them (see `launcherText` in
// `lib/setup/diff.mjs`).
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
} from "../../../lib/plan.mjs";
import {
  isObject,
  LAUNCHERS,
  launcherText,
  mergeProfile,
  profileFor,
} from "../../../lib/setup/diff.mjs";
import { backup, lspPlugins, memoryReport } from "../../../lib/setup/files.mjs";

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
    path.join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "templates",
      "settings.json",
    ),
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

const changes = [];

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
const EXTRA = { statusLine: { padding: 0, refreshInterval: 1 } };
const STATUS_LINES = LAUNCHERS.map(([key, stub, script]) => ({
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
    ...EXTRA[key],
  },
}));

const profileFile = readJson(profilePath, null);
if (!isObject(profileFile)) {
  console.error(`Profile ${profilePath} not found or not an object.`);
  process.exit(1);
}
const plan = planFlag ?? localPlan();
const profile = profileFor(profileFile, plan);
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
  mergeProfile(
    current,
    {
      ...profile,
      ...Object.fromEntries(ours.map((l) => [l.key, l.setting])),
    },
    "",
    changes,
  ).settings,
);
const staleStubs = ours.filter((l) => {
  const text = launcherText(l.script);
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
// A bad marketplace manifest only hides the LSP list, so it does not stop the settings merge.
let marketplace = {};
try {
  marketplace = JSON.parse(
    fs.readFileSync(
      path.join(
        configDir,
        "plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json",
      ),
      "utf8",
    ),
  );
} catch {}
const lsp = lspPlugins(
  (bin) => Bun.which(bin),
  marketplace,
  readJson(path.join(configDir, "plugins", "installed_plugins.json"), {}),
  readJson(targets.user, {}).enabledPlugins,
);
if (lsp.length) {
  console.log(
    "\nLanguage servers on PATH with no enabled LSP plugin. Run each:",
  );
  for (const command of lsp) console.log(`  ${command}`);
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
  fs.writeFileSync(l.stub, launcherText(l.script));
}
fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`);
console.log(
  `Wrote ${target}. Restart Claude Code for env and model settings to take effect.`,
);
