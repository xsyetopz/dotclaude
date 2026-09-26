#!/usr/bin/env bun
// Install dotclaude's managed-settings drop-in, a lock the user cannot undo
// without admin rights.
//
//   bun install-managed.mjs                      dry run: show target and content
//   sudo "$(command -v bun)" install-managed.mjs --apply [--yes] write the drop-in
//
// The drop-in is <managed dir>/managed-settings.d/50-dotclaude.json, where the
// managed dir is /Library/Application Support/ClaudeCode (macOS),
// /etc/claude-code (Linux and WSL), or C:\Program Files\ClaudeCode (Windows,
// print only). DOTCLAUDE_MANAGED_DIR overrides the managed dir.
// managed-settings.json is never written. Claude Code merges it first, then
// every *.json in managed-settings.d alphabetically, and refuses to start if a
// managed file is not a JSON object, so the new file is validated under a
// non-.json temp name before it is renamed into place, and backups go to the
// managed dir itself, outside managed-settings.d.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const yes = args.includes("--yes");

const DROP_IN = {
  maxEffortLevel: "xhigh",
  fastMode: false,
  fastModePerSessionOptIn: true,
  availableModels: ["claude-opus-5-5", "claude-fable-5-1", "claude-haiku-4-5"],
};
const content = `${JSON.stringify(DROP_IN, null, 2)}\n`;

const PLATFORM_DIRS = {
  darwin: "/Library/Application Support/ClaudeCode",
  linux: "/etc/claude-code",
  win32: "C:\\Program Files\\ClaudeCode",
};
const override = process.env.DOTCLAUDE_MANAGED_DIR;
const managedDir = override || PLATFORM_DIRS[process.platform];
if (!managedDir) {
  console.error(
    `No managed settings location is known for ${process.platform}.`,
  );
  process.exit(1);
}
const dropDir = path.join(managedDir, "managed-settings.d");
const target = path.join(dropDir, "50-dotclaude.json");

if (process.platform === "win32" && !override) {
  console.log(`Target: ${path.win32.join(dropDir, "50-dotclaude.json")}`);
  console.log(`\n${content}`);
  console.log(
    "This script does not write on Windows. Create the file with the content above from an administrator shell.",
  );
  process.exit(0);
}

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const baseFile = path.join(managedDir, "managed-settings.json");
if (fs.existsSync(baseFile)) {
  const base = parse(fs.readFileSync(baseFile, "utf8"));
  if (isObject(base)) {
    const shared = Object.keys(DROP_IN).filter((k) => Object.hasOwn(base, k));
    if (shared.length)
      console.log(
        `Note: ${baseFile} also sets ${shared.join(", ")}. The drop-in is merged after it. ${baseFile} is left as it is.\n`,
      );
  }
}

const old = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
const oldValue = old === null ? undefined : parse(old);
const action =
  old === null
    ? "create"
    : JSON.stringify(oldValue) === JSON.stringify(DROP_IN)
      ? "no-op"
      : "update";

console.log(`Target: ${target}`);
console.log(`\n${content}`);
if (action === "no-op") {
  console.log("Already installed with this content; nothing to change.");
  process.exit(0);
}

if (!apply) {
  console.log(
    `Dry run: nothing was written. With --apply this would ${action} the file. Run it with sudo:\n  sudo "${process.execPath}" "${process.argv[1]}" --apply`,
  );
  process.exit(0);
}

if (process.getuid?.() !== 0 && !override) {
  console.error(
    `Writing ${dropDir} needs admin rights. Run it with sudo:\n  sudo "${process.execPath}" "${process.argv[1]}" --apply`,
  );
  process.exit(1);
}

if (action === "update") {
  console.log(
    `The existing file differs.\n--- current\n${old}\n+++ new\n${content}`,
  );
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error(
        "Not overwriting without confirmation. Re-run in a terminal, or pass --yes.",
      );
      process.exit(1);
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // Ctrl+D or Ctrl+C at the prompt rejects; treat it as "no".
    const answer = await rl.question("Overwrite? [y/N] ").catch(() => "");
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("Left the existing file as it is.");
      process.exit(0);
    }
  }
}

fs.mkdirSync(dropDir, { recursive: true });
// Not .json, so Claude Code never reads a half-written file as a drop-in.
const temp = path.join(dropDir, `.50-dotclaude.tmp-${process.pid}`);
fs.writeFileSync(temp, content, { mode: 0o644 });
const written = parse(fs.readFileSync(temp, "utf8"));
if (!isObject(written) || JSON.stringify(written) !== JSON.stringify(DROP_IN)) {
  fs.rmSync(temp, { force: true });
  console.error(`Validation of ${temp} failed; nothing was written.`);
  process.exit(1);
}

if (old !== null) {
  // Outside managed-settings.d and not ending in .json, so it is never merged.
  const backup = path.join(
    managedDir,
    `50-dotclaude.json.dotclaude-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  fs.writeFileSync(backup, old);
  console.log(`Backup: ${backup}`);
}
fs.renameSync(temp, target);
console.log(
  `Wrote ${target}. Restart Claude Code for managed settings to take effect.`,
);
