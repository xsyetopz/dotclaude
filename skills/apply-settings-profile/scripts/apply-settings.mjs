#!/usr/bin/env bun
// Merge a dotclaude settings profile into a Claude Code settings file.
//
//   bun apply-settings.mjs [--scope user|project|local] [--profile file]
//                          [--skip name,...] [--apply]
//
// With the shipped profile, the switches in profiles/optional.json are merged
// too, except the ones named in --skip.
// Without --apply it prints the changes and writes nothing. With --apply it
// backs the file up next to itself, then writes the merged result.
// Merge rules: objects merge key by key, arrays gain missing entries, scalars
// take the profile value. The model policy (OWNED below) is replaced, not
// merged. With the shipped profile, the exact entries in STALE, which older
// dotclaude profiles wrote, are removed; nothing else already in the file is.

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

// Exact values that older dotclaude profiles wrote and 0.8 dropped. Only an
// exact match is removed, so a user's own setting of the same key stays.
const STALE = {
  // 0.7 and earlier denied it; 0.8 stopped.
  "permissions.deny": ["AskUserQuestion"],
  // Codex support was removed in 0.8.
  "permissions.allow": [
    "Bash(codex exec -p dotclaude-luna *)",
    "Bash(codex exec -p dotclaude-review *)",
  ],
  // 0.4.0 mapped `sonnet` to Opus 5.5, so every `sonnet` agent ran on Opus.
  "env.ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-opus-5-5",
};

// Keys where a user's own value wins over the profile. The profile sets the
// key only when it is unset or holds the value that an older profile wrote.
// 0.11.1 capped agents at 3, and 0.12 raised the cap to 5.
const USER_WINS = {
  "env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "3",
  "env.CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS": "3",
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
    } else if (
      Object.hasOwn(USER_WINS, where) &&
      existing !== undefined &&
      existing !== USER_WINS[where]
    ) {
      // The user's own value stays.
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
function dropStale(settings) {
  const out = structuredClone(settings);
  for (const [where, stale] of Object.entries(STALE)) {
    const keys = where.split(".");
    const last = keys.pop();
    const parent = keys.reduce((o, k) => (isObject(o) ? o[k] : undefined), out);
    if (!isObject(parent) || !Object.hasOwn(parent, last)) continue;
    const value = parent[last];
    const gone = Array.isArray(stale)
      ? (Array.isArray(value) ? value : []).filter((v) => stale.includes(v))
      : value === stale
        ? [value]
        : [];
    if (!gone.length) continue;
    if (Array.isArray(stale))
      parent[last] = value.filter((v) => !stale.includes(v));
    else delete parent[last];
    changes.push(
      `${where}: remove ${gone.map((v) => JSON.stringify(v)).join(", ")} (left by an older dotclaude profile)`,
    );
  }
  return out;
}

let merged = merge(
  profilePath === RECOMMENDED ? dropStale(current) : current,
  profile,
  "",
);
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
