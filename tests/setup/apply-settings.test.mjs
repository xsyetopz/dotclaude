// apply-settings.mjs, run against a temporary HOME so real settings are never touched.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { profileStamp } from "../../hooks/lib/_profile.mjs";
import {
  backups as backupsOf,
  FIXTURES,
  run,
  runWith,
  SCRIPTS,
  tempHome,
} from "../support/setup.mjs";

const backups = (home) =>
  backupsOf(path.join(home, ".claude", "settings.json"));

// A second --apply with nothing to change leaves the bytes and makes no backup.
function expectNoChange(home, file) {
  const bytes = fs.readFileSync(file, "utf8");
  const count = backups(home).length;
  run("apply-settings.mjs", home, "--apply");
  expect(fs.readFileSync(file, "utf8")).toBe(bytes);
  expect(backups(home).length).toBe(count);
}

test("apply-settings previews without writing, then merges without removing user keys", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      theme: "auto",
      permissions: { allow: ["mcp__codegraph__*"], deny: ["Read(~/.ssh/**)"] },
    }),
  );
  const before = fs.readFileSync(file, "utf8");
  expect(run("apply-settings.mjs", home)).toContain(
    "fastMode: (unset) -> false",
  );
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  expect(backups(home)).toStrictEqual([]);
  run("apply-settings.mjs", home, "--apply");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(merged.theme).toBe("auto");
  expect(merged.permissions.allow).toStrictEqual(["mcp__codegraph__*"]);
  expect(
    merged.permissions.deny.filter((r) => r === "Read(~/.ssh/**)").length,
  ).toBe(1);
  expect(merged.fastMode).toBe(false);
  expect(merged.env.CLAUDE_CODE_DISABLE_FAST_MODE).toBe("1");
  expect(backups(home).length).toBe(1);
  expect(
    fs.readFileSync(path.join(home, ".claude", backups(home)[0]), "utf8"),
  ).toBe(before);
  expectNoChange(home, file);
});

test("apply-settings keeps a user's own sonnet mapping and leaves Fable out on Pro without extra usage", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5-5" },
    }),
  );
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({
      oauthAccount: {
        organizationType: "claude_pro",
        hasExtraUsageEnabled: false,
      },
    }),
  );
  const preview = run("apply-settings.mjs", home);
  expect(preview).toContain(
    'availableModels: add "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"\n',
  );
  expect(preview).not.toContain("claude-fable");
  run("apply-settings.mjs", home, "--apply");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(merged.availableModels).toStrictEqual([
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-4-5",
  ]);
  expect(merged.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-sonnet-5-5");
  expect(merged.autoCompactWindow).toBe(150000);
});

test("apply-settings replaces the model policy: availableModels and Agent(model:) denies", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      availableModels: ["claude-opus-5-5", "claude-sonnet-5-5"],
      env: {
        KEEP_ME: "1",
      },
      permissions: {
        deny: [
          "Read(~/.ssh/**)",
          "Agent(model:sonnet*)",
          "Agent(model:haiku*)",
          "Agent(model:claude-sonnet*)",
          "Agent(model:claude-haiku*)",
        ],
      },
    }),
  );
  expect(run("apply-settings.mjs", home)).toMatch(
    /remove "Agent\(model:sonnet\*\)"/,
  );
  run("apply-settings.mjs", home, "--apply");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(merged.availableModels).toStrictEqual([
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-fable-5-1",
    "claude-haiku-4-5",
  ]);
  expect(merged.permissions.deny.includes("Read(~/.ssh/**)")).toBeTruthy();
  // Rules match the alias Claude sends (`fable`), never a full model ID.
  expect(merged.permissions.deny.includes("Agent(model:fable*)")).toBeTruthy();
  expect(
    merged.permissions.deny.includes("Agent(general-purpose)"),
  ).toBeTruthy();
  for (const gone of [
    "Agent(model:claude-fable*)",
    "Agent(model:sonnet*)",
    "Agent(model:haiku*)",
    "Agent(model:claude-sonnet*)",
    "Agent(model:claude-haiku*)",
  ])
    expect(!merged.permissions.deny.includes(gone), gone).toBeTruthy();
  expect(merged.autoCompactWindow).toBe(150000);
  expect(merged.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT).toBe("1");
  expect(merged.env.CLAUDE_CODE_GLOB_NO_IGNORE).toBe("false");
  expect(merged.promptSuggestionEnabled).toBe(false);
  expect(merged.awaySummaryEnabled).toBe(false);
  expect(merged.crossSessionInbound).toBe("hold");
  expect(merged.env.DOTCLAUDE_SETTINGS_PROFILE).toBe(profileStamp());
  expect(merged.env.KEEP_ME).toBe("1");
});

test("apply-settings adds the optional switches unless skipped", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  run("apply-settings.mjs", home, "--apply");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(all.env.CLAUDE_CODE_DISABLE_ARTIFACT).toBe("1");
  expect(all.permissions.deny).toContain("ScheduleWakeup");
  expect(all.permissions.deny).toContain("ReportFindings");
  expect(all.disableBundledSkills).toBe(true);
  expect(all.autoMemoryEnabled).toBe(false);

  const other = tempHome();
  const out = run(
    "apply-settings.mjs",
    other,
    "--skip",
    "artifact,loops",
    "--apply",
  );
  expect(out).not.toContain("CLAUDE_CODE_DISABLE_ARTIFACT");
  expect(out).not.toContain("CLAUDE_CODE_DISABLE_CRON");
  expect(out).toContain("CLAUDE_CODE_DISABLE_WORKFLOWS");
  const some = JSON.parse(
    fs.readFileSync(path.join(other, ".claude", "settings.json"), "utf8"),
  );
  expect(some.env.CLAUDE_CODE_DISABLE_ARTIFACT).toBeUndefined();
  expect(some.permissions.deny).not.toContain("ScheduleWakeup");
  expect(some.env.CLAUDE_CODE_DISABLE_WORKFLOWS).toBe("1");
  expect(some.env.DOTCLAUDE_SETTINGS_PROFILE).toBe(profileStamp());
});

/** Each leaf value of `obj` as [dotted path, value]; array items one by one. */
function leaves(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) => {
    const where = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) return value.map((v) => [where, v]);
    if (value !== null && typeof value === "object")
      return leaves(value, where);
    return [[where, value]];
  });
}

const at = (obj, where) => where.split(".").reduce((o, key) => o?.[key], obj);

function seed(home, settings) {
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return file;
}

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// The file that 0.16.1's `--apply` wrote over a user's own theme, model,
// env value, and permission rules, with every optional switch applied.
const SETTINGS_0_16_1 = path.join(FIXTURES, "0.16.1", "settings.json");

test("a 0.16.1 settings file gets auto-update on and keeps every other value", () => {
  const home = tempHome();
  const old = read(SETTINGS_0_16_1);
  const file = seed(home, old);
  const preview = run("apply-settings.mjs", home);
  expect(preview).toContain('env.DISABLE_AUTOUPDATER: remove "1"');
  expect(preview).toContain('autoUpdatesChannel: (unset) -> "stable"');
  run("apply-settings.mjs", home, "--apply");
  const merged = read(file);
  expect(merged.autoUpdatesChannel).toBe("stable");
  expect(merged.minimumVersion).toBe("2.1.286");
  const changed = {
    "env.DISABLE_AUTOUPDATER": undefined,
    "env.DOTCLAUDE_SETTINGS_PROFILE": profileStamp(),
  };
  for (const [where, value] of leaves(old)) {
    const now = at(merged, where);
    if (where in changed) expect(now, where).toBe(changed[where]);
    else if (Array.isArray(now)) expect(now, where).toContainEqual(value);
    else expect(now, where).toStrictEqual(value);
  }
  expectNoChange(home, file);
});

test("auto-update keeps the running version as the floor and never lowers one", () => {
  for (const [running, before, after] of [
    // A newer CLI on the latest channel does not step back to stable's.
    ["2-1-290", undefined, "2.1.290"],
    // An older CLI gets the tested release as its floor.
    ["2-1-285", undefined, "2.1.286"],
    // A higher floor that the user set stays.
    ["2-1-286", "2.1.300", "2.1.300"],
  ]) {
    const home = tempHome();
    const file = seed(home, before ? { minimumVersion: before } : {});
    const env = { AI_AGENT: `claude-code_${running}_agent` };
    runWith(env, "apply-settings.mjs", home, "--apply");
    expect(read(file).minimumVersion, running).toBe(after);
  }
});

test("auto-update off writes DISABLE_AUTOUPDATER and a re-run keeps it off", () => {
  const home = tempHome();
  const file = seed(home, {});
  run("apply-settings.mjs", home, "--auto-update", "off", "--apply");
  const off = read(file);
  expect(off.env.DISABLE_AUTOUPDATER).toBe("1");
  expect(off.autoUpdatesChannel).toBeUndefined();
  expect(off.minimumVersion).toBeUndefined();
  const bytes = fs.readFileSync(file, "utf8");
  run("apply-settings.mjs", home, "--auto-update", "off", "--apply");
  expect(fs.readFileSync(file, "utf8")).toBe(bytes);
});

test("auto-update names DISABLE_UPDATES and leaves it, because dotclaude never wrote it", () => {
  const home = tempHome();
  const file = seed(home, { env: { DISABLE_UPDATES: "1" } });
  const out = run("apply-settings.mjs", home, "--apply");
  expect(out).toContain("DISABLE_UPDATES");
  expect(read(file).env.DISABLE_UPDATES).toBe("1");
});

test("project and local scopes leave the auto-update keys alone", () => {
  const home = tempHome();
  const project = fs.mkdtempSync(path.join(home, "proj-"));
  const file = path.join(project, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ env: { DISABLE_AUTOUPDATER: "1" } }));
  runWith(
    { CLAUDE_PROJECT_DIR: project },
    "apply-settings.mjs",
    home,
    "--scope",
    "project",
    "--apply",
  );
  const merged = read(file);
  expect(merged.env.DISABLE_AUTOUPDATER).toBe("1");
  expect(merged.autoUpdatesChannel).toBeUndefined();
  expect(merged.minimumVersion).toBeUndefined();
});

test("an unknown --auto-update value stops before any write", () => {
  const home = tempHome();
  const file = seed(home, {});
  const res = Bun.spawnSync(
    [
      "bun",
      path.join(SCRIPTS, "apply-settings.mjs"),
      "--auto-update",
      "maybe",
      "--apply",
    ],
    { env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: "" } },
  );
  expect(res.exitCode).toBe(2);
  expect(fs.readFileSync(file, "utf8")).toBe("{}");
});

test("user scope follows CLAUDE_CONFIG_DIR for settings.json and CLAUDE.md", () => {
  const home = tempHome();
  const config = path.join(home, "other-config");
  fs.mkdirSync(config);
  const env = { CLAUDE_CONFIG_DIR: config };
  runWith(env, "apply-settings.mjs", home, "--apply");
  runWith(env, "apply-claude-md.mjs", home, "--apply");
  expect(fs.existsSync(path.join(config, "settings.json"))).toBe(true);
  expect(fs.existsSync(path.join(config, "CLAUDE.md"))).toBe(true);
  expect(fs.existsSync(path.join(home, ".claude", "settings.json"))).toBe(
    false,
  );
  expect(fs.existsSync(path.join(home, ".claude", "CLAUDE.md"))).toBe(false);
});
