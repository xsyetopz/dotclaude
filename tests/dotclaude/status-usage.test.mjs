import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderMain } from "../../plugins/dotclaude/status-line/render.mjs";
import {
  parseUsage,
  usageCopy,
} from "../../plugins/dotclaude/status-line/sources.mjs";

// Fixtures in the shape of `cachedUsageUtilization.utilization` from Claude
// Code 2.1.289 and the `cedar_ember` decoder of CodexBar 0.69.0.
const NOW = Date.parse("2026-10-04T12:00:00Z");
const iso = (hours) => new Date(NOW + hours * 3600_000).toISOString();
const grant = (over) => ({
  resets_left: 1,
  resets_total: 2,
  starts_at: iso(-24),
  ends_at: iso(24 * 8),
  paused: false,
  ...over,
});
const main = (usage, data = {}) =>
  Bun.stripANSI(renderMain(data, { now: NOW, usage }));

test("limit resets count only usable grants and keep the earliest expiry", () => {
  const resets = (cedar_ember) => parseUsage({ cedar_ember }, NOW).resets;
  expect(resets(null)).toBeUndefined();
  expect(resets({ eligible: false, grants: [grant()] })).toBeUndefined();
  expect(
    resets({
      eligible: true,
      grants: [
        grant({ paused: true }),
        grant({ ends_at: iso(-1) }),
        grant({ starts_at: iso(1) }),
        grant({ resets_left: 0 }),
        grant({ resets_left: "2" }),
      ],
    }),
  ).toBeUndefined();
  expect(
    resets({
      eligible: true,
      grants: [
        grant({ resets_left: 2, ends_at: iso(48) }),
        grant({ starts_at: null, ends_at: null }),
      ],
    }),
  ).toEqual({ left: 3, until: (NOW + 48 * 3600_000) / 1000 });
  expect(
    resets({ eligible: true, grants: [grant({ ends_at: null })] }),
  ).toEqual({ left: 1, until: null });
});

test("extra usage reads minor units and only while it is on", () => {
  const extra = (extra_usage) => parseUsage({ extra_usage }, NOW).extra;
  expect(extra({ is_enabled: false, used_credits: 500 })).toBeUndefined();
  expect(extra({ is_enabled: true, used_credits: null })).toBeUndefined();
  expect(
    extra({
      is_enabled: true,
      used_credits: 1250,
      monthly_limit: 5000,
      utilization: 25,
      currency: "USD",
    }),
  ).toEqual({ used: 12.5, limit: 50, pct: 25, currency: "USD" });
  expect(
    extra({ is_enabled: true, used_credits: 300, monthly_limit: null }),
  ).toEqual({ used: 3, limit: null, pct: null, currency: "USD" });
});

test("the core row shows resets and extra usage, and a reset outranks at a limit", () => {
  const resets = { left: 2, until: (NOW + 8 * 86_400_000) / 1000 };
  // `clock` prints local time, so the hour depends on the time zone.
  expect(main({ resets })).toMatch(
    /^⟳2 by Oct 1[123] at \d{1,2}(:\d\d)?[ap]m$/,
  );
  expect(main({ resets: { left: 1, until: null } })).toBe("⟳1");
  const extra = { used: 12.5, limit: 50, pct: 25, currency: "USD" };
  expect(main({ extra })).toBe("extra █░░░░ $12.50/$50");
  expect(main({ extra: { ...extra, limit: null } })).toBe("extra $12.50");
  expect(main({ extra: { ...extra, currency: "XYZ!" } })).toContain(
    "12.50 XYZ!",
  );
  // Five parts in 3 rows: the reset stays only while a window is at its limit.
  const tight = (used_percentage) =>
    Bun.stripANSI(
      renderMain(
        {
          model: { id: "claude-opus-5-5" },
          session_name: "s",
          rate_limits: {
            five_hour: { used_percentage, resets_at: NOW / 1000 + 3600 },
          },
        },
        { now: NOW, usage: { resets, extra }, columns: 10 },
      ),
    );
  expect(tight(100)).toContain("⟳2");
  expect(tight(100)).not.toContain("extra");
  expect(tight(10)).not.toContain("⟳");
});

test("`usageCopy` reads the copy in `.claude.json` and drops a stale one", () => {
  // A new folder for each copy, because `cached` keys its result by the path.
  const dirs = [];
  const write = (fetchedAtMs) => {
    const dir = mkdtempSync(join(tmpdir(), "dotclaude-usage-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, ".claude.json"),
      JSON.stringify({
        cachedUsageUtilization: {
          fetchedAtMs,
          utilization: {
            five_hour: { utilization: 9, resets_at: iso(2) },
            cedar_ember: { eligible: true, grants: [grant()] },
          },
        },
      }),
    );
    return { CLAUDE_CONFIG_DIR: dir };
  };
  try {
    const copy = usageCopy(write(NOW - 60_000), NOW);
    expect(copy.five_hour.used_percentage).toBe(9);
    expect(copy.resets.left).toBe(1);
    expect(usageCopy(write(NOW - 2 * 3600_000), NOW)).toBeNull();
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
});
