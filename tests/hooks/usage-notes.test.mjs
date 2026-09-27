// Usage-limit notes from Claude Code's cached usage.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { readUsage } from "../../hooks/lib/_usage.mjs";
import { isolatedHook as hook, tmp } from "../support/hooks.mjs";

/** A config dir whose cached usage was fetched `ageMs` ago. */
function usageDir(ageMs, { session, weekly, fable = 0 }) {
  const dir = tmp("dotclaude-usage-");
  fs.writeFileSync(
    path.join(dir, ".claude.json"),
    JSON.stringify({
      cachedUsageUtilization: {
        fetchedAtMs: Date.now() - ageMs,
        utilization: {
          five_hour: { utilization: session },
          seven_day: { utilization: weekly },
          limits: [
            { kind: "session", percent: session },
            { kind: "weekly_all", percent: weekly },
            {
              kind: "weekly_scoped",
              percent: fable,
              scope: { model: { display_name: "Fable" } },
            },
          ],
        },
      },
    }),
  );
  return dir;
}

test("readUsage reads Claude Code's cached usage and ignores a stale copy", () => {
  const fresh = readUsage({
    CLAUDE_CONFIG_DIR: usageDir(60_000, { session: 28, weekly: 87, fable: 3 }),
  });
  expect({
    session: fresh.session,
    weekly: fresh.weekly,
    fable: fresh.fable,
  }).toStrictEqual({ session: 28, weekly: 87, fable: 3 });
  expect(
    readUsage({
      CLAUDE_CONFIG_DIR: usageDir(2 * 3600_000, { session: 99, weekly: 99 }),
    }),
  ).toBe(null);
});

test("usage notes fire once per level: 75%, then 90%", () => {
  const data = tmp("dotclaude-data-");
  const prompt = (dir) =>
    hook(
      "user-prompt-submit/note-usage-limits.mjs",
      { session_id: "s3", prompt: "next step" },
      { CLAUDE_PLUGIN_DATA: data, CLAUDE_CONFIG_DIR: dir },
    );
  expect(prompt(usageDir(60_000, { session: 20, weekly: 50 }))).toBe(null);
  const at87 = prompt(usageDir(60_000, { session: 28, weekly: 87 }))
    .hookSpecificOutput.additionalContext;
  expect(at87).toMatch(/^\[dotclaude\] <usage_limits/);
  expect(at87).toMatch(/weekly 87%/);
  expect(at87).toMatch(/codex-worker/);
  expect(prompt(usageDir(60_000, { session: 30, weekly: 88 }))).toBe(null);
  const at91 = prompt(usageDir(60_000, { session: 91, weekly: 88 }))
    .hookSpecificOutput.additionalContext;
  expect(at91).toMatch(/start no new fan-out/);
});
