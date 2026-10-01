#!/usr/bin/env bun
// Merge a dotclaude settings profile into a Claude Code settings file.
//
//   bun apply-settings.mjs [--scope user|project|local] [--profile file]
//                          [--skip name,...] [--auto-update on|off] [--apply]
//
// With the shipped profile, the switches in profiles/optional.json are merged
// too, except the ones named in --skip.
// Without --apply it prints the changes and writes nothing. With --apply it
// backs the file up next to itself, then writes the merged result.
// Merge rules: objects merge key by key, arrays gain missing entries, scalars
// take the profile value. The model policy (OWNED below) is replaced, not
// merged. In user scope, --auto-update (on by default) sets the update
// channel and its version floor, or turns automatic updates off.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentPlan, fableAccess } from "../../../hooks/lib/_plans.mjs";
import {
  OPTIONAL,
  profileStamp,
  RECOMMENDED,
  STAMP_KEY,
} from "../../../hooks/lib/_profile.mjs";
import {
  claudeVersion,
  olderThan,
  TESTED_CLAUDE_CODE,
} from "../../../hooks/lib/_version.mjs";

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
const skip = new Set(
  flag("--skip", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const autoUpdate = flag("--auto-update", "on");
if (!["on", "off"].includes(autoUpdate)) {
  console.error(`Unknown --auto-update "${autoUpdate}". Use on or off.`);
  process.exit(2);
}
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const targets = {
  user: path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "settings.json",
  ),
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

function merge(current, profile, keyPath, owned = OWNED) {
  const out = isObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(profile)) {
    const where = keyPath ? `${keyPath}.${key}` : key;
    const existing = out[key];
    if (isObject(value)) {
      out[key] = merge(existing, value, where, owned);
    } else if (Array.isArray(value)) {
      const owns = owned[where] ?? (() => false);
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
profile.env = { ...profile.env, [STAMP_KEY]: profileStamp(profilePath) };
// A plan that runs Fable only on usage credits, with extra usage off, cannot
// use it, so the model list leaves it out there.
const { plan, account } = currentPlan();
if (
  fableAccess(plan, account) === "unavailable" &&
  Array.isArray(profile.availableModels)
) {
  profile.availableModels = profile.availableModels.filter(
    (m) => !/fable/i.test(m),
  );
  console.log(
    `Claude plan: ${plan}, which runs Fable on usage credits with extra usage off; availableModels leaves Fable out.`,
  );
}
let merged = merge(current, profile, "");
if (profilePath === RECOMMENDED) {
  const optional = readJson(OPTIONAL, {});
  for (const name of skip)
    if (!Object.hasOwn(optional, name)) {
      console.error(
        `Unknown switch "${name}". Known: ${Object.keys(optional).join(", ")}.`,
      );
      process.exit(2);
    }
  for (const [name, { settings }] of Object.entries(optional)) {
    if (skip.has(name)) console.log(`Skipped switch: ${name}`);
    // The switches only add; the model policy is the base profile's.
    else merged = merge(merged, settings, "", {});
  }
}

if (scope === "user") merged = applyAutoUpdate(merged);

/**
 * On: the stable channel, with the running version as the floor, so a CLI on
 * the latest channel does not step back. A higher floor stays. Off:
 * `DISABLE_AUTOUPDATER`. `autoUpdates` in `~/.claude.json` is the native
 * installer's own flag, so this never writes it.
 */
function applyAutoUpdate(settings) {
  const out = structuredClone(settings);
  const env = isObject(out.env) ? out.env : {};
  if (autoUpdate === "off")
    return merge(out, { env: { DISABLE_AUTOUPDATER: "1" } }, "", {});
  if (Object.hasOwn(env, "DISABLE_AUTOUPDATER")) {
    changes.push(
      `env.DISABLE_AUTOUPDATER: remove ${JSON.stringify(env.DISABLE_AUTOUPDATER)}`,
    );
    delete env.DISABLE_AUTOUPDATER;
  }
  const running = claudeVersion();
  let floor =
    running && olderThan(TESTED_CLAUDE_CODE, running)
      ? running
      : TESTED_CLAUDE_CODE;
  const own = out.minimumVersion;
  if (typeof own === "string" && olderThan(floor, own)) floor = own;
  if (env.DISABLE_UPDATES)
    console.log(
      "Note: env.DISABLE_UPDATES is set, and it blocks every update. dotclaude did not write it, so it stays. Remove it to let auto-update run.",
    );
  return merge(
    out,
    { autoUpdatesChannel: "stable", minimumVersion: floor },
    "",
    {},
  );
}

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
