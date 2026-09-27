// apply-settings.mjs, run against a temporary HOME so real settings are never touched.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
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
  expect(merged.permissions.allow).toStrictEqual([
    "mcp__codegraph__*",
    "Bash(codex exec -p dotclaude-luna *)",
    "Bash(codex exec -p dotclaude-review *)",
  ]);
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
  // A small 5-hour window compacts at half the usual size.
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
        CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "40",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-5-5",
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
  expect(merged.autoCompactWindow).toBe(400000);
  expect(merged.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT).toBe("1");
  expect(merged.promptSuggestionEnabled).toBe(false);
  expect(merged.awaySummaryEnabled).toBe(false);
  expect(merged.crossSessionInbound).toBe("hold");
  // The 0.4.0 mapping of `sonnet` to Opus 5.5 is taken out again.
  expect(
    !Object.hasOwn(merged.env, "ANTHROPIC_DEFAULT_SONNET_MODEL"),
  ).toBeTruthy();
  // A retired env key the 0.2.0 profile set is removed; the user's own stays.
  expect(
    !Object.hasOwn(merged.env, "CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION"),
  ).toBeTruthy();
  expect(merged.env.KEEP_ME).toBe("1");
});
