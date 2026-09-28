#!/usr/bin/env bun
// Install or remove dotclaude's status line in the user's Claude Code settings.
//
//   bun apply-statusline.mjs [--remove] [--apply]
//
// A plugin cannot set `statusLine`, so this writes a stub at a fixed path
// (see hooks/lib/_status-line.mjs) and points the user settings'
// `statusLine` at it. Session start keeps the stub pointing at the current
// plugin version. Without --apply it prints what would change and writes
// nothing. With --apply it backs the settings file up first. --remove takes
// out the stub, and the `statusLine` setting only when it runs the stub.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installedStatusLine,
  statusLineSetting,
  stubText,
} from "../../../hooks/lib/_status-line.mjs";

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const apply = args.includes("--apply");
const config =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const target = path.join(config, "settings.json");
const stub = installedStatusLine();
const wanted = statusLineSetting(stub);

let settings = {};
if (fs.existsSync(target)) {
  try {
    settings = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (err) {
    console.error(
      `${target} is not valid JSON (${err.message}); nothing was changed.`,
    );
    process.exit(1);
  }
}
const current = settings.statusLine;
// Ownership is the command it runs, not the whole object, so an older
// install (same stub, no refreshInterval yet) is still ours to update.
const ours = current?.command === wanted.command;
const upToDate = ours && current.refreshInterval === wanted.refreshInterval;
const changes = [];
if (remove) {
  if (ours) changes.push("statusLine: remove");
  else if (current)
    console.log(
      `statusLine runs ${JSON.stringify(current.command)}, not dotclaude's; it stays.`,
    );
  if (fs.existsSync(stub)) changes.push(`delete ${stub}`);
} else {
  if (!ours)
    changes.push(
      `statusLine: ${current ? JSON.stringify(current.command) : "(unset)"} -> ${JSON.stringify(wanted.command)}`,
    );
  else if (!upToDate)
    changes.push(
      `statusLine: refreshInterval ${current.refreshInterval ?? "(unset)"} -> ${wanted.refreshInterval}`,
    );
  const text = stubText();
  if (!fs.existsSync(stub) || fs.readFileSync(stub, "utf8") !== text)
    changes.push(`write ${stub}`);
}

console.log(`Target: ${target}`);
if (!changes.length) {
  console.log("Already up to date; nothing to change.");
  process.exit(0);
}
for (const line of changes) console.log(`  ${line}`);
if (!apply) {
  console.log(
    "\nDry run: nothing was written. Re-run with --apply to write these changes.",
  );
  process.exit(0);
}

if (fs.existsSync(target)) {
  const backup = `${target}.dotclaude-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(target, backup);
  console.log(`Backup: ${backup}`);
}
if (remove) {
  if (ours) delete settings.statusLine;
  fs.rmSync(stub, { force: true });
} else {
  settings.statusLine = wanted;
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.writeFileSync(stub, stubText());
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`);
console.log(`Wrote ${target}. The status line updates on the next event.`);
