// dotclaude's replacement for Claude Code's built-in system prompt. Only the
// `--system-prompt-file` CLI flag replaces that prompt, and a plugin cannot
// pass CLI flags, so apply-launcher.mjs installs a `claude` shell function
// that passes it. The function reads a copy at a fixed path, because the
// plugin's own directory changes with every version. Session start keeps
// that copy equal to the shipped file, with the installed Claude Code version
// filled in.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SHIPPED = path.resolve(
  import.meta.dir,
  "../../skills/apply-settings-profile/profiles/system-prompt.md",
);

const SLOT = "{{CLAUDE_CODE_VERSION}}";

/** The copy the shell function reads. */
export function installedPrompt() {
  const config =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(config, "dotclaude", "system-prompt.md");
}

/**
 * The installed Claude Code version, such as "2.1.283", or null. Inside a
 * session CLAUDE_CODE_EXECPATH names the running binary, so a second install
 * on PATH does not answer.
 */
export function claudeVersion() {
  const res = spawnSync(
    process.env.CLAUDE_CODE_EXECPATH || "claude",
    ["--version"],
    { encoding: "utf8", timeout: 5000 },
  );
  return res.stdout?.match(/^(\d+\.\d+\.\d+\S*)/)?.[1] ?? null;
}

/** The shipped prompt with `version` filled in, or without a version. */
export function renderPrompt(version = claudeVersion()) {
  const text = fs.readFileSync(SHIPPED, "utf8");
  return version
    ? text.replaceAll(SLOT, version)
    : text.replaceAll(` v${SLOT}`, "");
}

/**
 * Rewrite an installed copy that differs from the rendered prompt. Returns
 * "content" when the shipped text changed, "version" when only the Claude
 * Code version changed, and false when it wrote nothing. A missing copy means
 * the launcher is not installed, so it stays missing.
 */
export function syncPrompt(
  target = installedPrompt(),
  version = claudeVersion(),
) {
  let current;
  try {
    current = fs.readFileSync(target, "utf8");
  } catch {
    return false;
  }
  const next = renderPrompt(version);
  if (current === next) return false;
  fs.writeFileSync(target, next);
  const old = current.match(/Claude Code v(\S+?),/)?.[1] ?? null;
  return current === renderPrompt(old) ? "version" : "content";
}

export const LAUNCHER_BEGIN = "# >>> dotclaude system prompt >>>";

/**
 * The startup file apply-launcher.mjs writes the function to for `shell`
 * (zsh, bash, or fish), or null for another shell. PowerShell's profile path
 * needs a pwsh process, so the launcher script finds that one itself.
 */
export function shellStartupFile(shell) {
  const home = os.homedir();
  switch (shell) {
    case "zsh":
      return path.join(process.env.ZDOTDIR || home, ".zshrc");
    case "bash":
      // macOS terminals start login shells, which read .bash_profile.
      return path.join(
        home,
        process.platform === "darwin" ? ".bash_profile" : ".bashrc",
      );
    case "fish":
      // A file of its own in conf.d, which fish reads at every start.
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
        "fish",
        "conf.d",
        "dotclaude.fish",
      );
    default:
      return null;
  }
}
