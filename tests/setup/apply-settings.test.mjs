// apply-settings.mjs, run against a temporary HOME so real settings are never touched.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { profileStamp } from "../../hooks/lib/_profile.mjs";
import { run, tempHome } from "../support/setup.mjs";

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
  expect(run("apply-settings.mjs", home)).toMatch(/Dry run/);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  run("apply-settings.mjs", home, "--apply");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(merged.theme).toBe("auto");
  expect(merged.permissions.allow).toStrictEqual(["mcp__codegraph__*"]);
  expect(
    merged.permissions.deny.filter((r) => r === "Read(~/.ssh/**)").length,
  ).toBe(1);
  expect(merged.fastMode).toBe(false);
  expect(merged.env.CLAUDE_CODE_DISABLE_FAST_MODE).toBe("1");
  expect(
    fs
      .readdirSync(path.join(home, ".claude"))
      .some((f) => f.startsWith("settings.json.dotclaude-backup-")),
  ).toBeTruthy();
  expect(run("apply-settings.mjs", home)).toMatch(/Already up to date/);
});

test("apply-settings keeps a user's own sonnet mapping and leaves Fable out on Pro without extra usage", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5" },
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
  expect(run("apply-settings.mjs", home)).toMatch(/leaves Fable out/);
  run("apply-settings.mjs", home, "--apply");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(merged.availableModels).toStrictEqual([
    "claude-opus-5-5",
    "claude-sonnet-5",
    "claude-haiku-4-5",
  ]);
  expect(merged.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-sonnet-5");
  expect(merged.autoCompactWindow).toBe(200000);
});

test("apply-settings replaces the model policy: availableModels and Agent(model:) denies", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      availableModels: ["claude-opus-5-5", "claude-sonnet-5"],
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
    "claude-sonnet-5",
    "claude-fable-5-1",
    "claude-haiku-4-5",
  ]);
  expect(merged.permissions.deny.includes("Read(~/.ssh/**)")).toBeTruthy();
  // Rules match the alias Claude sends (`fable`), never a full model ID.
  expect(merged.permissions.deny.includes("Agent(model:fable*)")).toBeTruthy();
  for (const gone of [
    "Agent(model:claude-fable*)",
    "Agent(model:sonnet*)",
    "Agent(model:haiku*)",
    "Agent(model:claude-sonnet*)",
    "Agent(model:claude-haiku*)",
  ])
    expect(!merged.permissions.deny.includes(gone), gone).toBeTruthy();
  expect(merged.autoCompactWindow).toBe(200000);
  expect(merged.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT).toBe("1");
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
  expect(all.env.DISABLE_AUTOUPDATER).toBe("1");
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
  expect(out).toMatch(/Skipped switch: artifact/);
  const some = JSON.parse(
    fs.readFileSync(path.join(other, ".claude", "settings.json"), "utf8"),
  );
  expect(some.env.CLAUDE_CODE_DISABLE_ARTIFACT).toBeUndefined();
  expect(some.permissions.deny).not.toContain("ScheduleWakeup");
  expect(some.env.CLAUDE_CODE_DISABLE_WORKFLOWS).toBe("1");
  expect(some.env.DOTCLAUDE_SETTINGS_PROFILE).toBe(profileStamp());
});

test("apply-settings removes exact entries older profiles wrote and keeps look-alikes", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-5-5" },
      permissions: {
        allow: [
          "Bash(codex exec -p dotclaude-luna *)",
          "Bash(codex exec -p dotclaude-review *)",
          "Bash(codex exec *)",
        ],
        deny: ["AskUserQuestion", "Read(~/.ssh/**)"],
      },
    }),
  );
  const preview = run("apply-settings.mjs", home);
  expect(preview).toMatch(
    /permissions\.deny: remove "AskUserQuestion" \(left by an older dotclaude profile\)/,
  );
  expect(preview).toMatch(/env\.ANTHROPIC_DEFAULT_SONNET_MODEL: remove/);
  run("apply-settings.mjs", home, "--apply");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(merged.permissions.allow).toStrictEqual(["Bash(codex exec *)"]);
  expect(merged.permissions.deny).not.toContain("AskUserQuestion");
  expect(merged.permissions.deny).toContain("Read(~/.ssh/**)");
  expect(merged.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
  expect(merged.env.CLAUDE_CODE_FORK_SUBAGENT).toBe("0");
  expect(run("apply-settings.mjs", home)).toMatch(/Already up to date/);
});
