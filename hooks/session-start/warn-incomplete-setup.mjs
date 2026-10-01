#!/usr/bin/env bun

// SessionStart(startup|resume): tell the user (not Claude) when the settings
// profile is missing or stale, when a global effort override flattens the
// agents' effort levels, when Claude Code or the Bun on PATH is older than the
// plugin needs, and once per version when Claude Code is newer than the
// release this plugin was tested on. With secret redaction on, it says when
// betterleaks is missing.

import fs from "node:fs";
import path from "node:path";
import { emit, option, run } from "../lib/_common.mjs";
import { profileStamp, STAMP_KEY } from "../lib/_profile.mjs";
import { scannerInstalled } from "../lib/_secrets.mjs";
import {
  syncStatusLine,
  syncSubagentStatusLine,
} from "../lib/_status-line.mjs";
import {
  claudeVersion,
  MIN_CLAUDE_CODE,
  olderThan,
  TESTED_CLAUDE_CODE,
} from "../lib/_version.mjs";

const MIN_BUN = "1.4.2";

/**
 * True the first time this plugin data dir sees `version`. The marker sits
 * outside `sessions/`, which pruning empties.
 */
function firstStartOn(version) {
  const dir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dir) return false;
  const marker = path.join(dir, "claude-code-version-noted");
  try {
    if (fs.readFileSync(marker, "utf8") === version) return false;
  } catch {}
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(marker, version);
  return true;
}

run(() => {
  const notices = [];
  const env = process.env;
  // Settings env reaches hooks from every scope, so the stamp counts wherever
  // the profile was applied.
  if (option("model_lock") && !env[STAMP_KEY]) {
    notices.push(
      "the settings profile is not applied yet. Run `/dotclaude:setup` to apply it.",
    );
  } else if (option("model_lock") && env[STAMP_KEY] !== profileStamp()) {
    notices.push(
      "your settings profile is out of date: this version of the plugin changed it. Run `/dotclaude:setup` to update it.",
    );
  }
  if (env.CLAUDE_CODE_EFFORT_LEVEL) {
    notices.push(
      `CLAUDE_CODE_EFFORT_LEVEL=${env.CLAUDE_CODE_EFFORT_LEVEL} overrides every subagent's own effort, so the dotclaude agents all run at that level. Unset it and use /effort for the session instead.`,
    );
  }
  const version = claudeVersion();
  if (version && olderThan(version, MIN_CLAUDE_CODE)) {
    notices.push(
      `it needs Claude Code ${MIN_CLAUDE_CODE} or later, and this session runs ${version}. Run \`claude update\`, then restart Claude Code.`,
    );
  }
  if (
    version &&
    olderThan(TESTED_CLAUDE_CODE, version) &&
    firstStartOn(version)
  ) {
    notices.push(
      `this version was tested on Claude Code ${TESTED_CLAUDE_CODE}, and this session runs ${version}. If a hook or skill misbehaves, update the plugin with \`claude plugin update dotclaude@dotclaude\`.`,
    );
  }
  if (typeof Bun !== "undefined" && olderThan(Bun.version, MIN_BUN)) {
    notices.push(
      `its hooks need Bun ${MIN_BUN} or later, and ${Bun.version} is on PATH. Run \`bun upgrade\`.`,
    );
  }
  if (option("guard_secrets") && !scannerInstalled()) {
    notices.push(
      "secret redaction is on, but betterleaks is not on PATH, so tool output reaches Claude unscanned. Run `brew install betterleaks`, or turn off the guard_secrets option.",
    );
  }
  syncStatusLine();
  syncSubagentStatusLine();
  if (notices.length) emit({ systemMessage: notices.join(" Also, ") });
});
