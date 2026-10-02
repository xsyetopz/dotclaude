#!/usr/bin/env bun

// SessionStart(startup|resume): tell the user (not Claude) when the settings
// profile is missing or stale, when a global effort override flattens the
// agents' effort levels, and when Claude Code or the Bun on PATH is older than
// the plugin needs. With secret redaction on, it says when betterleaks is
// missing.

import { emit, option, run } from "../lib/_common.mjs";
import { profileStamp, STAMP_KEY } from "../lib/_profile.mjs";
import { scannerInstalled } from "../lib/_secrets.mjs";
import {
  syncStatusLine,
  syncSubagentStatusLine,
} from "../lib/_status-line.mjs";
import { CLAUDE_CODE, claudeVersion, olderThan } from "../lib/_version.mjs";

const MIN_BUN = "1.4.2";

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
  if (version && olderThan(version, CLAUDE_CODE)) {
    notices.push(
      `it needs Claude Code ${CLAUDE_CODE} or later, and this session runs ${version}. Run \`claude update\`, then restart Claude Code.`,
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
