#!/usr/bin/env bun
// Merge a dotclaude settings profile into a Claude Code settings file.
//
//   bun apply-settings.mjs [--scope user|project|local] [--profile file] [--apply]
//
// Without --apply it prints the changes and writes nothing. With --apply it
// backs the file up next to itself, then writes the merged result.
// Merge rules: objects merge key by key, arrays gain missing entries, scalars
// take the profile value. The model policy (OWNED below) is replaced, not
// merged; nothing else already in the file is removed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const scope = flag("--scope", "user");
const profilePath = path.resolve(
  flag("--profile", path.join(here, "..", "profiles", "recommended.json")),
);
const apply = args.includes("--apply");
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const targets = {
  user: path.join(os.homedir(), ".claude", "settings.json"),
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
      `${file} is not valid JSON (${err.message}); nothing was changed.`,
    );
    process.exit(1);
  }
}

// The model policy is dotclaude's to set: these arrays take the profile's
// entries (matching `owns`) instead of gaining them, so a model rule the
// profile no longer carries does not linger.
const OWNED = {
  availableModels: () => true,
  "permissions.deny": (entry) => /^Agent\(model:/.test(String(entry)),
};

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const changes = [];

function merge(current, profile, keyPath) {
  const out = isObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(profile)) {
    const where = keyPath ? `${keyPath}.${key}` : key;
    const existing = out[key];
    if (isObject(value)) {
      out[key] = merge(existing, value, where);
    } else if (Array.isArray(value)) {
      const owns = OWNED[where] ?? (() => false);
      const all = Array.isArray(existing) ? existing : [];
      const base = all.filter((v) => !owns(v) || value.includes(v));
      if (base.length < all.length)
        changes.push(
          `${where}: remove ${all
            .filter((v) => !base.includes(v))
            .map((v) => JSON.stringify(v))
            .join(", ")}`,
        );
      const added = value.filter(
        (v) => !base.some((b) => JSON.stringify(b) === JSON.stringify(v)),
      );
      if (added.length)
        changes.push(
          `${where}: add ${added.map((v) => JSON.stringify(v)).join(", ")}`,
        );
      out[key] = [...base, ...added];
    } else if (JSON.stringify(existing) !== JSON.stringify(value)) {
      changes.push(
        `${where}: ${existing === undefined ? "(unset)" : JSON.stringify(existing)} -> ${JSON.stringify(value)}`,
      );
      out[key] = value;
    }
  }
  return out;
}

const current = readJson(target, {});
const profile = readJson(profilePath, null);
if (!isObject(profile)) {
  console.error(`Profile ${profilePath} not found or not an object.`);
  process.exit(1);
}
const merged = merge(current, profile, "");

console.log(`Target: ${target} (${scope} scope)`);
if (!changes.length) {
  console.log("Already up to date; nothing to change.");
  process.exit(0);
}
console.log(`${changes.length} change(s):`);
for (const line of changes) console.log(`  ${line}`);

if (!apply) {
  console.log(
    "\nDry run: nothing was written. Re-run with --apply to write these changes.",
  );
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
