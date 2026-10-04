#!/usr/bin/env bun
// Merge profiles/recommended.json into a Claude Code settings file, and remove
// CodeGraph's `prompt-hook` entry.
//
//   bun settings.mjs [--scope user|project|local] [--profile file] [--apply]
//
// Without --apply, it prints what differs and writes nothing. That is also the
// status. With --apply, it backs the file up next to itself, then writes.
// Merge rules: objects merge key by key, arrays gain missing entries, and
// scalars take the profile value. `availableModels` is replaced, because the
// profile owns the model list. The script also reports a CodeGraph MCP entry
// in `.claude.json`, which the skill removes with `claude mcp remove`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

const profile = readJson(profilePath, null);
if (!isObject(profile)) {
  console.error(`Profile ${profilePath} not found or not an object.`);
  process.exit(1);
}
const merged = removeCodegraphHook(merge(readJson(target, {}), profile, ""));

const claudeJson = process.env.CLAUDE_CONFIG_DIR
  ? path.join(configDir, ".claude.json")
  : path.join(os.homedir(), ".claude.json");
const mcp = readJson(claudeJson, {}).mcpServers;
const codegraphMcp = isObject(mcp) && Object.hasOwn(mcp, "codegraph");

console.log(`Target: ${target} (${scope} scope)`);
console.log(
  changes.length
    ? `${changes.length} change(s):`
    : "Settings match the profile.",
);
for (const line of changes) console.log(`  ${line}`);
if (codegraphMcp)
  console.log(
    `CodeGraph MCP entry found in ${claudeJson}. Remove it with: claude mcp remove codegraph -s user`,
  );
if (!changes.length || !apply) {
  if (changes.length)
    console.log("\nDry run. Run again with --apply to write these changes.");
  process.exit(0);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) {
  const backup = `${target}.dotclaude-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(target, backup);
  console.log(`\nBackup: ${backup}`);
}
fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`);
console.log(
  `Wrote ${target}. Restart Claude Code for env and model settings to take effect.`,
);
