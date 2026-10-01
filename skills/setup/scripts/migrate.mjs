#!/usr/bin/env bun
// Remove or rename what dotclaude 0.16 left:
//
//   - the `claude` shell function between the dotclaude marker comments, in
//     every shell startup file where 0.16's launcher could write it;
//   - the system-prompt copy that the function read;
//   - the plugin option keys that 0.17 renamed, in the user settings'
//     `pluginConfigs`. Claude Code keeps keys that a plugin no longer
//     declares, so the old ones go in the same write.
//
//   bun migrate.mjs [--rc file] [--apply]
//
// Without --apply it prints what it would change and writes nothing. With
// --apply it backs up each changed file next to itself first. Pass
// --rc for a startup file that 0.16 was given with its own --rc.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BLOCK =
  /# >>> dotclaude system prompt >>>\n[\s\S]*?# <<< dotclaude system prompt <<<\n?/;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rc = args.includes("--rc") ? args[args.indexOf("--rc") + 1] : null;

const home = os.homedir();
const config = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
const prompt = path.join(config, "dotclaude", "system-prompt.md");
const settings = path.join(config, "settings.json");

/** Option keys that 0.17 renamed: old name to new name. */
const RENAMED_OPTIONS = {
  bash_guard: "guard_bash",
  edit_guard: "guard_edit",
  secret_redaction: "guard_secrets",
  ask_in_auto_mode: "guard_ask_in_auto",
  stop_gate: "gate_verify",
  task_check: "gate_tasks",
  goal_loop_guard: "gate_goal_stall",
  nested_instructions: "context_nested_instructions",
  exclude_session_files: "context_session_files",
  compact_carryover: "context_compact_carryover",
  handoff_pointer: "context_handoff_pointer",
  subagent_guidance: "agent_guidance",
  turn_limit_handoff: "usage_agent_bounds",
  scratchpad_prune_days: "usage_scratchpad_prune_days",
  claude_plan: "model_plan",
  allowed_models: "model_allowed",
  commit_hygiene: "git_commit_hygiene",
};
// 0.16 wrote fish's function to a file of its own, so the whole file goes.
const fish = path.join(
  process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
  "fish",
  "conf.d",
  "dotclaude.fish",
);
const PWSH = "Microsoft.PowerShell_profile.ps1";
const startupFiles = [
  path.join(process.env.ZDOTDIR || home, ".zshrc"),
  path.join(home, ".bashrc"),
  path.join(home, ".bash_profile"),
  fish,
  path.join(home, ".config", "powershell", PWSH),
  path.join(home, "Documents", "PowerShell", PWSH),
  path.join(home, "Documents", "WindowsPowerShell", PWSH),
  ...(rc ? [path.resolve(rc)] : []),
];

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

const edits = [];
for (const file of new Set(startupFiles)) {
  const current = read(file);
  if (current === null || !BLOCK.test(current)) continue;
  const next = current.replace(BLOCK, "").replace(/\n+$/, "\n");
  edits.push({ file, current, next: next.trim() ? next : "" });
}
const promptThere = fs.existsSync(prompt);

// A value already set under the new name wins over the old one.
const renames = [];
const settingsText = read(settings);
let settingsNext = null;
if (settingsText !== null) {
  let parsed = null;
  try {
    parsed = JSON.parse(settingsText);
  } catch {
    console.log(`Skips ${settings}: it is not valid JSON.`);
  }
  for (const [id, entry] of Object.entries(parsed?.pluginConfigs ?? {})) {
    const options = entry?.options;
    if (!id.startsWith("dotclaude@") || !options || typeof options !== "object")
      continue;
    for (const [from, to] of Object.entries(RENAMED_OPTIONS)) {
      if (!Object.hasOwn(options, from)) continue;
      if (!Object.hasOwn(options, to)) options[to] = options[from];
      delete options[from];
      renames.push(`${id}: ${from} -> ${to}`);
    }
  }
  if (renames.length) settingsNext = `${JSON.stringify(parsed, null, 2)}\n`;
}

if (!edits.length && !promptThere && !renames.length) {
  console.log("No dotclaude 0.16 leftovers found; nothing to change.");
  process.exit(0);
}
for (const { file, next } of edits)
  console.log(
    file === fish && !next
      ? `Deletes ${file} (dotclaude's \`claude\` function).`
      : `Removes dotclaude's \`claude\` function from ${file}.`,
  );
if (promptThere) console.log(`Deletes the system-prompt copy ${prompt}.`);
if (renames.length)
  console.log(
    `Renames plugin options in ${settings}:\n${renames.map((r) => `  ${r}`).join("\n")}`,
  );
if (!apply) {
  console.log("\nDry run: nothing was written. Re-run with --apply to write.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const { file, current, next } of edits) {
  const backup = `${file}.dotclaude-backup-${stamp}`;
  fs.writeFileSync(backup, current);
  if (file === fish && !next) fs.rmSync(file);
  else fs.writeFileSync(file, next);
  console.log(`Backup: ${backup}`);
}
fs.rmSync(prompt, { force: true });
if (settingsNext !== null) {
  const backup = `${settings}.dotclaude-backup-${stamp}`;
  fs.writeFileSync(backup, settingsText);
  fs.writeFileSync(settings, settingsNext);
  console.log(`Backup: ${backup}`);
}
if (edits.length)
  console.log(
    "Open a new terminal, or run `unfunction claude` (zsh), `unset -f claude` (bash), `functions -e claude` (fish), or `Remove-Item Function:claude` (PowerShell). Until then, the old function finds no prompt copy and starts Claude Code without changes.",
  );
