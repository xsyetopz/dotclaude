#!/usr/bin/env bun
// SessionStart(startup|resume): tell the user (not Claude) when the settings
// profile is missing or stale, when a global effort override flattens the
// agents' effort levels, or when the Bun on PATH is older than the hooks need.

import fs from "node:fs";
import path from "node:path";
import { emit, option, projectRoot, run } from "../lib/_common.mjs";

const MIN_BUN = "1.4.2";

function managedDir() {
  if (process.env.DOTCLAUDE_MANAGED_DIR)
    return process.env.DOTCLAUDE_MANAGED_DIR;
  if (process.platform === "darwin")
    return "/Library/Application Support/ClaudeCode";
  if (process.platform === "win32") return "C:\\Program Files\\ClaudeCode";
  return "/etc/claude-code";
}

/**
 * Whether no settings scope sets the effort cap the 0.3.0 profile adds. The
 * profile can be applied at user, project, or local scope, and the cap can
 * also come from managed settings or their drop-ins.
 */
function effortCapMissing(data) {
  const userDir =
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.HOME ?? "", ".claude");
  const root = projectRoot(data);
  const dropDir = path.join(managedDir(), "managed-settings.d");
  let dropIns = [];
  try {
    dropIns = fs
      .readdirSync(dropDir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .map((name) => path.join(dropDir, name));
  } catch {}
  const files = [
    path.join(userDir, "settings.json"),
    path.join(root, ".claude", "settings.json"),
    path.join(root, ".claude", "settings.local.json"),
    path.join(managedDir(), "managed-settings.json"),
    ...dropIns,
  ];
  return !files.some((file) => {
    try {
      const settings = JSON.parse(fs.readFileSync(file, "utf8"));
      return settings?.maxEffortLevel !== undefined;
    } catch {
      return false;
    }
  });
}

function olderThan(version, minimum) {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < b.length; i += 1) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) < b[i];
  }
  return false;
}

run((data) => {
  const notices = [];
  const env = process.env;
  if (option("model_lock") && env.CLAUDE_CODE_DISABLE_FAST_MODE !== "1") {
    notices.push(
      "fast mode is not disabled in your settings yet. Run /dotclaude:apply-settings-profile to apply the settings profile.",
    );
  } else if (option("model_lock") && !env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    notices.push(
      "your settings profile is out of date: Haiku 4.5 (Claude Code's background tasks and dotclaude's setup and Codex relay agents) is not configured. Run /dotclaude:apply-settings-profile to update it.",
    );
  } else if (option("model_lock") && effortCapMissing(data)) {
    notices.push(
      "your settings profile is out of date: the effort cap (maxEffortLevel) is not set. Run /dotclaude:apply-settings-profile to update it.",
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
  if (notices.length)
    emit({ systemMessage: `dotclaude: ${notices.join(" Also, ")}` });
});
