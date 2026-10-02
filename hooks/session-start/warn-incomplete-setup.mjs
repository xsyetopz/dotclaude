#!/usr/bin/env bun

// SessionStart(startup|resume): tell the user (not Claude) when the settings
// profile is missing or stale, when a global effort override flattens the
// agents' effort levels, and when Claude Code or the Bun on PATH is older than
// the plugin needs. With secret redaction on, it says when betterleaks is
// missing.

import { emit, run } from "../lib/_common.mjs";
import { option } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { profileStamp, STAMP_KEY } from "../lib/_profile.mjs";
import { scannerInstalled } from "../lib/_secrets.mjs";
import {
  syncStatusLine,
  syncSubagentStatusLine,
} from "../lib/_status-line.mjs";
import { CLAUDE_CODE, claudeVersion, olderThan } from "../lib/_version.mjs";

const MIN_BUN = "1.4.2";

run(async (data) => {
  const notices = [];
  const env = process.env;
  // Settings env reaches hooks from every scope, so the stamp counts wherever
  // the profile was applied.
  if (option(process.env, "model_lock") && !env[STAMP_KEY]) {
    notices.push(
      "The dotclaude settings profile is not applied yet. Run `/dotclaude:setup` to apply it.",
    );
  } else if (
    option(process.env, "model_lock") &&
    env[STAMP_KEY] !== profileStamp()
  ) {
    notices.push(
      "This version of dotclaude changed its settings profile, so your profile is out of date. Run `/dotclaude:setup` to update it.",
    );
  }
  if (env.CLAUDE_CODE_EFFORT_LEVEL) {
    notices.push(
      `\`CLAUDE_CODE_EFFORT_LEVEL=${env.CLAUDE_CODE_EFFORT_LEVEL}\` overrides the effort of each subagent, so all dotclaude agents run at that level. Unset it, and use \`/effort\` to set the effort of the session.`,
    );
  }
  const version = claudeVersion();
  if (version && olderThan(version, CLAUDE_CODE)) {
    notices.push(
      `dotclaude needs Claude Code ${CLAUDE_CODE} or later, and this session runs ${version}. Run \`claude update\`, then restart Claude Code.`,
    );
  }
  if (typeof Bun !== "undefined" && olderThan(Bun.version, MIN_BUN)) {
    notices.push(
      `The dotclaude hooks need Bun ${MIN_BUN} or later, and Bun ${Bun.version} is on \`PATH\`. Run \`bun upgrade\`.`,
    );
  }
  if (
    option(process.env, "guard_secrets") &&
    !(await scannerInstalled(nodeIo(data)))
  ) {
    notices.push(
      "Secret redaction is on, but `betterleaks` is not on `PATH`, so tool output goes to Claude without a scan. Run `brew install betterleaks`, or turn off the `guard_secrets` option.",
    );
  }
  syncStatusLine();
  syncSubagentStatusLine();
  if (notices.length) emit({ systemMessage: notices.join(" ") });
});
