#!/usr/bin/env bun
// SessionStart(startup|resume): tell the user (not Claude) when the settings
// profile is missing or stale, when a global effort override flattens the
// agents' effort levels, or when the Bun on PATH is older than the hooks need.

import { emit, option, run } from "../lib/_common.mjs";

const MIN_BUN = "1.4.2";

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
  if (option("model_lock") && env.CLAUDE_CODE_DISABLE_FAST_MODE !== "1") {
    notices.push(
      "fast mode is not disabled in your settings yet. Run /dotclaude:apply-settings-profile to apply the settings profile.",
    );
  } else if (option("model_lock") && !env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    notices.push(
      "your settings profile is out of date: Haiku 4.5 (web research, Claude Code's background tasks) is not configured. Run /dotclaude:apply-settings-profile to update it.",
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
