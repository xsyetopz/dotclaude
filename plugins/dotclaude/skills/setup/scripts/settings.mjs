#!/usr/bin/env node
// Merge templates/settings.json into a Claude Code settings file.
//
//   node settings.mjs [--scope user|project|local] [--profile file] [--status-line] [--apply]
//
// Without --apply, it prints the changes and writes nothing.
// With --apply, it backs up each changed file next to itself, keeps the newest three backups, then writes.
// Merge rules: see `mergeProfile` in `lib/setup.mjs`.
//
// --apply also writes `<config dir>/dotclaude/statusline.mjs`, a stub that runs this plugin's status line,
// and sets `statusLine` to run it.
// A status line of another tool stays, unless `--status-line` is given.
//
// It also removes what dotclaude 0.26 wrote and 0.27 does not use:
// the `LEGACY` keys, the `subagentStatusLine` stub, and the `CLAUDE.md` block of user scope.
// Then it reports OpenSpec, the LSP plugins to enable, and the managed settings copy command.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  backup,
  CLAUDE_MD_BLOCK,
  dropLegacy,
  isObject,
  launcherText,
  lspPlugins,
  mergeProfile,
  OPENSPEC_MIN,
  olderThan,
} from "../../../lib/setup.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const pluginRoot = path.join(import.meta.dirname, "..", "..", "..");
const scope = flag("--scope", "user");
const profilePath = path.resolve(
  flag("--profile", path.join(pluginRoot, "templates", "settings.json")),
);
const apply = args.includes("--apply");
const replaceStatusLine = args.includes("--status-line");
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

const profile = readJson(profilePath, null);
if (!isObject(profile)) {
  console.error(`Profile ${profilePath} not found or not an object.`);
  process.exit(1);
}

const STUB_DIR = path.join(configDir, "dotclaude");
const stub = path.join(STUB_DIR, "statusline.mjs");
const script = path.join(pluginRoot, "status-line", "statusline.mjs");
const statusLine = {
  type: "command",
  command: `node ${JSON.stringify(stub)}`,
  padding: 0,
};
const ours = (setting) =>
  isObject(setting) && String(setting.command ?? "").includes(STUB_DIR);

const changes = [];
const current = readJson(target, {});
// A status line whose command does not run a dotclaude stub belongs to another tool.
const foreign =
  !replaceStatusLine &&
  isObject(current.statusLine) &&
  !ours(current.statusLine);
let merged = dropLegacy(current, changes);
if (ours(merged.subagentStatusLine)) {
  changes.push(
    `subagentStatusLine: ${merged.subagentStatusLine.command} -> (unset)`,
  );
  delete merged.subagentStatusLine;
}
merged = mergeProfile(
  merged,
  foreign ? profile : { ...profile, statusLine },
  "",
  changes,
).settings;
const staleStub =
  !foreign &&
  !(
    fs.existsSync(stub) &&
    fs.readFileSync(stub, "utf8") === launcherText(script)
  );
if (staleStub) changes.push(`write ${stub}`);

const claudeMd = path.join(configDir, "CLAUDE.md");
const claudeMdText =
  scope === "user" && fs.existsSync(claudeMd)
    ? fs.readFileSync(claudeMd, "utf8")
    : "";
const oldBlock = CLAUDE_MD_BLOCK.test(claudeMdText);
if (oldBlock) changes.push(`${claudeMd}: remove the dotclaude 0.26 block`);

console.log(`Target: ${target} (${scope} scope)`);
console.log(
  changes.length
    ? `${changes.length} change(s):`
    : "Settings match the profile.",
);
for (const line of changes) console.log(`  ${line}`);
if (foreign)
  console.log(
    `Kept your statusLine: ${current.statusLine.command}. Run again with --status-line to use the dotclaude status line.`,
  );

// OpenSpec is report only.
// The skill asks the user before it installs or initializes anything.
const run = (cmd) => {
  try {
    const r = spawnSync(cmd[0], cmd.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
};
const openspec = run(["openspec", "--version"]);
const node = run(["node", "--version"])?.replace(/^v/, "");
console.log("\nOpenSpec:");
if (!openspec) console.log("  openspec: not found");
else if (olderThan(openspec, OPENSPEC_MIN))
  console.log(`  openspec: ${openspec}, older than ${OPENSPEC_MIN}`);
else console.log(`  openspec: ${openspec}`);
console.log(
  `  node: ${node ?? "not found"}${node && olderThan(node, "20.19.0") ? ", older than 20.19.0" : ""}`,
);
console.log(
  `  project: ${fs.existsSync(path.join(projectDir, "openspec")) ? "initialized" : "not initialized"} (${projectDir})`,
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
  (bin) => run([process.platform === "win32" ? "where" : "which", bin]),
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

const managedDir = {
  darwin: "/Library/Application Support/ClaudeCode",
  linux: "/etc/claude-code",
  win32: "C:\\Program Files\\ClaudeCode",
}[process.platform];
if (managedDir) {
  const from = path.join(pluginRoot, "templates", "managed-settings.json");
  console.log(
    "\nTo enforce the safety keys for all users of this computer, an administrator can run:",
  );
  console.log(
    process.platform === "win32"
      ? `  copy "${from}" "${managedDir}\\managed-settings.json"`
      : `  sudo mkdir -p "${managedDir}" && sudo cp "${from}" "${managedDir}/managed-settings.json"`,
  );
}

if (!changes.length || !apply) {
  if (changes.length)
    console.log("\nDry run. Run again with --apply to write these changes.");
  process.exit(0);
}
const report = ({ made, deleted }) => {
  console.log(`Backup: ${made}`);
  for (const f of deleted) console.log(`Deleted old backup: ${f}`);
};
console.log("");
fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) report(backup(target));
if (staleStub) {
  fs.mkdirSync(STUB_DIR, { recursive: true });
  fs.writeFileSync(stub, launcherText(script));
}
const oldSubagentStub = path.join(STUB_DIR, "subagents.mjs");
if (fs.existsSync(oldSubagentStub) && !ours(merged.subagentStatusLine))
  fs.rmSync(oldSubagentStub);
fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`);
if (oldBlock) {
  report(backup(claudeMd));
  fs.writeFileSync(claudeMd, claudeMdText.replace(CLAUDE_MD_BLOCK, ""));
}
console.log(
  `Wrote ${target}. Restart Claude Code for env and model settings to take effect.`,
);
