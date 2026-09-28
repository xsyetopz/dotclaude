// Usage-limit notes from Claude Code's cached usage.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { readUsage } from "../../hooks/lib/_usage.mjs";
import { isolatedHook as hook, tmp } from "../support/hooks.mjs";

/** A config dir whose cached usage was fetched `ageMs` ago. */
function usageDir(
  ageMs,
  { session, weekly, fable = 0, sessionReset, weeklyReset },
) {
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
            { kind: "session", percent: session, resets_at: sessionReset },
            { kind: "weekly_all", percent: weekly, resets_at: weeklyReset },
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
  expect(at87).toMatch(/Stretch what is left: prefer the Sonnet 5/);
  expect(prompt(usageDir(60_000, { session: 30, weekly: 88 }))).toBe(null);
  const at91 = prompt(usageDir(60_000, { session: 91, weekly: 88 }))
    .hookSpecificOutput.additionalContext;
  expect(at91).toMatch(/start no new fan-out/);
});

test("readUsage returns the reset times", () => {
  const usage = readUsage({
    CLAUDE_CONFIG_DIR: usageDir(60_000, {
      session: 100,
      weekly: 40,
      sessionReset: "2026-09-27T08:09:59.549386+00:00",
    }),
  });
  expect(usage.sessionResetsAt).toBe(Date.parse("2026-09-27T08:09:59.549Z"));
  expect(usage.weeklyResetsAt).toBe(null);
});

test("a usage-limit stop shows the limit, its reset, and the resume command", () => {
  const stop = (env, input = {}) =>
    hook(
      "stop-failure/notify-rate-limit.mjs",
      { session_id: "s9", error: "rate_limit", ...input },
      { TERM_PROGRAM: "ghostty", TZ: "UTC", ...env },
    );
  const reset = "2026-09-27T08:10:00Z";
  const session = stop({
    CLAUDE_CONFIG_DIR: usageDir(60_000, {
      session: 100,
      weekly: 40,
      sessionReset: reset,
    }),
  }).terminalSequence;
  // The time is in the user's locale, so allow a 12-hour clock.
  expect(session.startsWith("\u001b]777;notify;Claude Code;")).toBe(true);
  expect(session.endsWith("\u0007")).toBe(true);
  expect(session).toMatch(
    /;session usage limit reached, resets 0?8:10( AM)?\. Resume: claude --resume s9/,
  );
  const weekly = stop({
    TERM_PROGRAM: "iTerm.app",
    CLAUDE_CONFIG_DIR: usageDir(60_000, {
      session: 10,
      weekly: 100,
      weeklyReset: reset,
    }),
  }).terminalSequence;
  expect(weekly.startsWith("\u001b]9;Claude Code: weekly usage limit")).toBe(
    true,
  );
  expect(weekly).toMatch(/resets Sun,? 0?8:10( AM)?\./);
  const unknown = stop({ CLAUDE_CONFIG_DIR: tmp("dotclaude-none-") });
  expect(unknown.terminalSequence).toMatch(
    /;Usage limit reached\. Resume: claude --resume s9/,
  );
  expect(stop({}, { error: "overloaded" })).toBe(null);
  expect(stop({ CLAUDE_PLUGIN_OPTION_USAGE_NOTES: "false" })).toBe(null);
});
