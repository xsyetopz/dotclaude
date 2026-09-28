#!/usr/bin/env bun

// SessionStart(startup|resume): tell the user (not Claude) when the settings
// profile is missing or stale, when a global effort override flattens the
// agents' effort levels, or when the Bun on PATH is older than the hooks need.
// It also updates the launcher's copy of the dotclaude system prompt when this
// plugin version ships a different one, and says when the session started
// without that prompt: the launcher is not installed, or an IDE or another
// program started Claude Code without the shell function. With secret
// redaction on, it says when gitleaks is missing.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emit, option, run } from "../lib/_common.mjs";
import { profileStamp, STAMP_KEY } from "../lib/_profile.mjs";
import { gitleaksInstalled } from "../lib/_secrets.mjs";
import {
  syncStatusLine,
  syncSubagentStatusLine,
} from "../lib/_status-line.mjs";
import {
  installedPrompt,
  LAUNCHER_BEGIN,
  shellStartupFile,
  syncPrompt,
} from "../lib/_system-prompt.mjs";

const MIN_BUN = "1.4.2";

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

const tilde = (file) =>
  file.startsWith(`${os.homedir()}${path.sep}`)
    ? `~${file.slice(os.homedir().length)}`
    : file;

function olderThan(version, minimum) {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < b.length; i += 1) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) < b[i];
  }
  return false;
}

run(() => {
  const notices = [];
  const env = process.env;
  // Settings env reaches hooks from every scope, so the stamp counts wherever
  // the profile was applied.
  if (option("model_lock") && !env[STAMP_KEY]) {
    notices.push(
      "the settings profile is not applied yet. Run /dotclaude:apply-settings-profile to apply it.",
    );
  } else if (option("model_lock") && env[STAMP_KEY] !== profileStamp()) {
    notices.push(
      "your settings profile is out of date: this version of the plugin changed it. Run /dotclaude:apply-settings-profile to update it.",
    );
  }
  if (env.CLAUDE_CODE_EFFORT_LEVEL) {
    notices.push(
      `CLAUDE_CODE_EFFORT_LEVEL=${env.CLAUDE_CODE_EFFORT_LEVEL} overrides every subagent's own effort, so the dotclaude agents all run at that level. Unset it and use /effort for the session instead.`,
    );
  }
  if (typeof Bun !== "undefined" && olderThan(Bun.version, MIN_BUN)) {
    notices.push(
      `its hooks need Bun ${MIN_BUN} or later, and ${Bun.version} is on PATH. Run \`bun upgrade\`.`,
    );
  }
  // DOTCLAUDE_SYSTEM_PROMPT=0 is the user's choice to run without the prompt.
  if (env.DOTCLAUDE_SYSTEM_PROMPT !== "0") {
    const RULES =
      "This session has none of dotclaude's engineering or git rules, only the output style's rules on how to talk and report";
    if (!fs.existsSync(installedPrompt())) {
      notices.push(
        `the dotclaude system prompt is not installed. ${RULES}. Run /dotclaude:apply-settings-profile to install its launcher, or set DOTCLAUDE_SYSTEM_PROMPT=0 to run without it.`,
      );
    } else if (!env.DOTCLAUDE_LAUNCHER) {
      const rc = shellStartupFile(path.basename(env.SHELL ?? ""));
      const installed = rc && readText(rc).includes(LAUNCHER_BEGIN);
      const fix = installed
        ? `\`${tilde(rc)}\` has the function, so the terminal started before the function was there, or an IDE started Claude Code. Run \`source ${tilde(rc)}\` or open a new terminal, then start \`claude\` again.`
        : "Start Claude Code from a terminal that loads the function. If the function is out of date, run /dotclaude:apply-settings-profile again.";
      notices.push(
        `this session did not start through dotclaude's \`claude\` shell function. ${RULES}. ${fix} To run without the prompt, set DOTCLAUDE_SYSTEM_PROMPT=0.`,
      );
    }
  }
  if (option("secret_redaction") && !gitleaksInstalled()) {
    notices.push(
      "secret redaction is on, but gitleaks is not on PATH, so tool output reaches Claude unscanned. Run `brew install gitleaks`, or turn off the secret_redaction option.",
    );
  }
  syncStatusLine();
  syncSubagentStatusLine();
  if (syncPrompt() === "content") {
    notices.push(
      "this plugin version changed the dotclaude system prompt. The launcher's copy is updated, and new sessions use it.",
    );
  }
  if (notices.length) emit({ systemMessage: notices.join(" Also, ") });
});
