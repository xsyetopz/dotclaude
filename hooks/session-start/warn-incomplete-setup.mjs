#!/usr/bin/env bun
// SessionStart(startup|resume): tell the user (not Claude) when fast mode is
// still enabled in settings or the Bun on PATH is older than the hooks need.

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
  if (
    option("model_lock") &&
    process.env.CLAUDE_CODE_DISABLE_FAST_MODE !== "1"
  ) {
    notices.push(
      "fast mode is not disabled in your settings yet. Run /dotclaude:apply-settings-profile to apply the settings profile.",
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
