#!/usr/bin/env bun
// Install, update, or remove the `claude` shell function that starts Claude
// Code with dotclaude's system prompt.
//
//   bun apply-launcher.mjs [--shell zsh|bash|fish|pwsh] [--rc file] [--remove] [--apply]
//
// The function passes `--system-prompt-file` before the user's own arguments,
// because the CLI rejects the flag after a subcommand. It passes nothing when
// the user gives their own `--system-prompt` or `--system-prompt-file`, when
// DOTCLAUDE_SYSTEM_PROMPT=0, or when the prompt copy is missing. It sets
// DOTCLAUDE_LAUNCHER=1 either way, so session start can tell a session that
// bypassed it, such as one an IDE started.
//
// The function sits between marker comments in the shell's startup file, so
// re-running replaces it in place. Without --apply it prints what would
// change and writes nothing. With --apply it backs the file up first and
// writes the prompt, with the installed Claude Code version filled in, to the
// path the function reads.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installedPrompt,
  LAUNCHER_BEGIN,
  renderPrompt,
  shellStartupFile,
} from "../../../hooks/lib/_system-prompt.mjs";

const END = "# <<< dotclaude system prompt <<<";
const NOTE =
  "# Managed by /dotclaude:apply-settings-profile. Edits inside this block are replaced.";
const BLOCK =
  /# >>> dotclaude system prompt >>>\n[\s\S]*?# <<< dotclaude system prompt <<<\n?/;
const SHELLS = ["zsh", "bash", "fish", "pwsh"];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const remove = args.includes("--remove");
const apply = args.includes("--apply");
const home = os.homedir();
const prompt = installedPrompt();
const rendered = renderPrompt();

function detectShell() {
  if (process.platform === "win32") return "pwsh";
  const name = path.basename(process.env.SHELL ?? "");
  return SHELLS.includes(name) ? name : null;
}

/** The profile path PowerShell reports, or its default. */
function pwshProfile() {
  for (const exe of ["pwsh", "powershell"]) {
    const res = spawnSync(
      exe,
      ["-NoProfile", "-NonInteractive", "-Command", "$PROFILE"],
      { encoding: "utf8" },
    );
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  return process.platform === "win32"
    ? path.join(
        home,
        "Documents",
        "PowerShell",
        "Microsoft.PowerShell_profile.ps1",
      )
    : path.join(
        home,
        ".config",
        "powershell",
        "Microsoft.PowerShell_profile.ps1",
      );
}

function startupFile(shell) {
  return shellStartupFile(shell) ?? pwshProfile();
}

// For a word inside double quotes in sh.
const dq = (s) => s.replace(/[\\$`"]/g, "\\$&");
const fishQuote = (s) =>
  `'${s.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const psQuote = (s) => `'${s.replaceAll("'", "''")}'`;

function body(shell) {
  switch (shell) {
    case "zsh":
    case "bash":
      return `claude() {
  local f="\${DOTCLAUDE_SYSTEM_PROMPT_FILE:-${dq(prompt)}}" a
  if [ "\${DOTCLAUDE_SYSTEM_PROMPT:-1}" = 0 ] || [ ! -r "$f" ]; then
    DOTCLAUDE_LAUNCHER=1 command claude "$@"
    return
  fi
  for a in "$@"; do
    case $a in
      --system-prompt | --system-prompt=* | --system-prompt-file | --system-prompt-file=*)
        DOTCLAUDE_LAUNCHER=1 command claude "$@"
        return
        ;;
    esac
  done
  DOTCLAUDE_LAUNCHER=1 command claude --system-prompt-file "$f" "$@"
}`;
    case "fish":
      return `function claude --description 'Claude Code with the dotclaude system prompt'
    set -l f ${fishQuote(prompt)}
    test -n "$DOTCLAUDE_SYSTEM_PROMPT_FILE"; and set f $DOTCLAUDE_SYSTEM_PROMPT_FILE
    if test "$DOTCLAUDE_SYSTEM_PROMPT" = 0; or not test -r "$f"
        DOTCLAUDE_LAUNCHER=1 command claude $argv
        return
    end
    for a in $argv
        switch $a
            case --system-prompt '--system-prompt=*' --system-prompt-file '--system-prompt-file=*'
                DOTCLAUDE_LAUNCHER=1 command claude $argv
                return
        end
    end
    DOTCLAUDE_LAUNCHER=1 command claude --system-prompt-file "$f" $argv
end`;
    default:
      return `function claude {
  $env:DOTCLAUDE_LAUNCHER = '1'
  $f = if ($env:DOTCLAUDE_SYSTEM_PROMPT_FILE) { $env:DOTCLAUDE_SYSTEM_PROMPT_FILE } else { ${psQuote(prompt)} }
  $exe = (Get-Command claude -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $own = $args | Where-Object { "$_" -match '^--system-prompt(-file)?(=|$)' }
  if ($env:DOTCLAUDE_SYSTEM_PROMPT -eq '0' -or -not (Test-Path -LiteralPath $f) -or $own) {
    & $exe @args
  } else {
    & $exe --system-prompt-file $f @args
  }
}`;
  }
}

/** Auto memory's instructions are in the built-in prompt this replaces. */
function autoMemoryOn() {
  if (process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY) return false;
  try {
    const file = path.join(path.dirname(path.dirname(prompt)), "settings.json");
    return (
      JSON.parse(fs.readFileSync(file, "utf8")).autoMemoryEnabled !== false
    );
  } catch {
    return true;
  }
}

const shell = flag("--shell") ?? detectShell();
if (!SHELLS.includes(shell)) {
  console.error(
    `Could not tell the shell from SHELL=${process.env.SHELL ?? ""}. Pass --shell ${SHELLS.join("|")}.`,
  );
  process.exit(2);
}
const target = path.resolve(flag("--rc") ?? startupFile(shell));
const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";

let next;
if (remove) {
  next = current.replace(BLOCK, "").replace(/\n{3,}$/, "\n\n");
} else {
  const block = `${LAUNCHER_BEGIN}\n${NOTE}\n${body(shell)}\n${END}\n`;
  next = BLOCK.test(current)
    ? current.replace(BLOCK, block)
    : current.trim()
      ? `${current.replace(/\s*$/, "")}\n\n${block}`
      : block;
}
const promptCurrent =
  fs.existsSync(prompt) && fs.readFileSync(prompt, "utf8") === rendered;
const promptChange = remove ? fs.existsSync(prompt) : !promptCurrent;

console.log(`Shell: ${shell}. Startup file: ${target}`);
console.log(`Prompt copy: ${prompt}`);
// A conflict stays a problem after the block is in place, so these print on
// every run.
if (!remove) {
  if (shell !== "fish" && /^\s*alias\s+claude=/m.test(current))
    console.log(
      "\nWarning: this file also defines `alias claude`. An alias takes precedence over the function, so remove the alias first.",
    );
  if (autoMemoryOn())
    console.log(
      "\nWarning: auto memory is on. Its instructions are part of the built-in prompt that this replaces, so Claude stops reading and writing memory as intended. Turn auto memory off (`autoMemoryEnabled: false`) or remove the launcher.",
    );
}
if (next === current && !promptChange) {
  console.log("Already up to date; nothing to change.");
  process.exit(0);
}
if (next !== current)
  console.log(
    remove
      ? "Removes the dotclaude `claude` function."
      : BLOCK.test(current)
        ? "Replaces the existing dotclaude `claude` function."
        : "Adds a `claude` function; the rest of the file is unchanged.",
  );
if (promptChange)
  console.log(remove ? "Deletes the prompt copy." : "Writes the prompt copy.");
if (!remove) {
  console.log(`\n----- block -----\n${next.match(BLOCK)[0]}-----------------`);
}
if (!apply) {
  console.log("\nDry run: nothing was written. Re-run with --apply to write.");
  process.exit(0);
}
if (next !== current) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (current) {
    const backup = `${target}.dotclaude-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(target, backup);
    console.log(`\nBackup: ${backup}`);
  }
  if (remove && !next.trim() && shell === "fish") fs.rmSync(target);
  else fs.writeFileSync(target, next);
  console.log(`Wrote ${target}.`);
}
if (remove) {
  fs.rmSync(prompt, { force: true });
} else if (promptChange) {
  fs.mkdirSync(path.dirname(prompt), { recursive: true });
  fs.writeFileSync(prompt, rendered);
}
console.log(
  remove
    ? "Open a new terminal, or run `unfunction claude` (zsh), `unset -f claude` (bash), `functions -e claude` (fish), or `Remove-Item Function:claude` (PowerShell)."
    : "Open a new terminal so the function loads. Set DOTCLAUDE_SYSTEM_PROMPT=0 to start one session with Claude Code's own prompt.",
);
