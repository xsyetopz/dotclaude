import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATUS_REFRESH_SECONDS } from "../hooks/lib/_budget.mjs";

const SCRIPTS = fileURLToPath(
  new URL("../skills/setup/scripts/", import.meta.url),
);
const PROFILE = JSON.parse(
  readFileSync(
    new URL("../skills/setup/profiles/recommended.json", import.meta.url),
  ),
);

function run(script, dir, ...args) {
  const r = Bun.spawnSync(["bun", join(SCRIPTS, script), ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  return { out: r.stdout.toString(), code: r.exitCode };
}
const settingsOf = (dir) =>
  JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));

test("profile keeps the decided values", () => {
  expect(PROFILE.maxEffortLevel).toBe("high");
  expect(PROFILE.model).toBe("claude-opus-5-5");
  expect(PROFILE.availableModels).toEqual([
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-4-5",
  ]);
  expect(PROFILE.autoCompactWindow).toBe(150000);
  expect(PROFILE.cleanupPeriodDays).toBe(14);
  // Subagents almost never pause 5 minutes, so the 1-hour write price costs more (wiki/Design.md).
  expect(PROFILE.subagentPromptCacheTtl).toBeUndefined();
  expect(PROFILE.enableArtifact).toBe(false);
  expect(PROFILE.disableBundledSkills).toBe(true);
  expect(PROFILE.env.CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS).toBe("1");
  expect(JSON.stringify(PROFILE)).not.toMatch(/fable|opusplan/i);
});

test("a preview writes nothing and --apply merges with a backup", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      theme: "dark",
      availableModels: ["claude-fable-5-1"],
      permissions: { deny: ["Read(x)"] },
    }),
  );
  const preview = run("settings.mjs", dir);
  expect(preview.out).toContain("maxEffortLevel");
  expect(settingsOf(dir).maxEffortLevel).toBeUndefined();

  run("settings.mjs", dir, "--apply");
  const merged = settingsOf(dir);
  expect(merged.theme).toBe("dark");
  expect(merged.maxEffortLevel).toBe("high");
  expect(merged.availableModels).toEqual(PROFILE.availableModels);
  expect(merged.permissions.deny).toContain("Read(x)");
  expect(merged.permissions.deny).toContain("Agent(general-purpose)");
  expect(readdirSync(dir).some((f) => f.includes("dotclaude-backup"))).toBe(
    true,
  );
  expect(run("settings.mjs", dir).out).toContain("match the profile");
});

test("it removes the CodeGraph prompt hook and keeps other hooks", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  const keep = { type: "command", command: "echo keep" };
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "codegraph prompt-hook" }] },
          { hooks: [keep] },
        ],
      },
    }),
  );
  run("settings.mjs", dir, "--apply");
  expect(settingsOf(dir).hooks.UserPromptSubmit).toEqual([{ hooks: [keep] }]);
});

test("it reports a CodeGraph MCP entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  writeFileSync(
    join(dir, ".claude.json"),
    JSON.stringify({ mcpServers: { codegraph: {} } }),
  );
  expect(run("settings.mjs", dir).out).toContain("claude mcp remove codegraph");
});

test("the CLAUDE.md block is added once and replaced in place", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  writeFileSync(join(dir, "CLAUDE.md"), "# Mine\n");
  run("claude-md.mjs", dir, "--apply");
  run("claude-md.mjs", dir, "--apply");
  const text = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  expect(text.startsWith("# Mine\n")).toBe(true);
  expect(text.match(/dotclaude:begin/g)).toHaveLength(1);
});

test("a status line of another tool stays unless --status-line is given", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  const theirs = { type: "command", command: "ccusage statusline" };
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ statusLine: theirs }),
  );
  const { out } = run("settings.mjs", dir, "--apply");
  expect(out).toContain("Kept your statusLine: ccusage statusline");
  expect(settingsOf(dir).statusLine).toEqual(theirs);
  expect(settingsOf(dir).subagentStatusLine.command).toContain("dotclaude");
  expect(existsSync(join(dir, "dotclaude", "statusline.mjs"))).toBe(false);
  run("settings.mjs", dir, "--status-line", "--apply");
  expect(settingsOf(dir).statusLine.command).toContain("statusline.mjs");
});

test("--apply wires both status lines through stubs that run the plugin scripts", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  expect(run("settings.mjs", dir).out).toContain("statusline.mjs");
  expect(existsSync(join(dir, "dotclaude"))).toBe(false);
  run("settings.mjs", dir, "--apply");
  const merged = settingsOf(dir);
  const main = join(dir, "dotclaude", "statusline.mjs");
  const sub = join(dir, "dotclaude", "subagent-statusline.mjs");
  expect(merged.statusLine).toEqual({
    type: "command",
    command: `bun ${JSON.stringify(main)}`,
    padding: 0,
    refreshInterval: STATUS_REFRESH_SECONDS,
  });
  expect(merged.subagentStatusLine.command).toBe(`bun ${JSON.stringify(sub)}`);
  const stubOut = (file, input) =>
    Bun.spawnSync(["bun", file], {
      stdin: Buffer.from(input),
    }).stdout.toString();
  expect(
    Bun.stripANSI(
      stubOut(
        main,
        JSON.stringify({ context_window: { total_input_tokens: 87_000 } }),
      ),
    ),
  ).toContain("87k/117k");
  expect(
    Bun.stripANSI(
      stubOut(
        sub,
        JSON.stringify({ tasks: [{ id: "a", name: "w", tokenCount: 62_000 }] }),
      ),
    ),
  ).toContain("62k/100k");
  expect(run("settings.mjs", dir).out).toContain("match the profile");
});

test("a stub in the plugin cache runs the newest version that is not orphaned", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-cache-"));
  const versions = join(dir, "cache", "dotclaude", "dotclaude");
  const repo = join(SCRIPTS, "..", "..", "..");
  for (const part of ["hooks/lib", "skills/setup", "status-line"])
    cpSync(join(repo, part), join(versions, "0.9.0", part), {
      recursive: true,
    });
  const fake = (version, text) => {
    mkdirSync(join(versions, version, "status-line"), { recursive: true });
    writeFileSync(
      join(versions, version, "status-line", "main.mjs"),
      `console.log(${JSON.stringify(text)});`,
    );
  };
  fake("0.10.0", "newest");
  fake("0.11.0", "orphaned");
  writeFileSync(join(versions, "0.11.0", ".orphaned_at"), "1");
  const settings = join(versions, "0.9.0", "skills/setup/scripts/settings.mjs");
  Bun.spawnSync(["bun", settings, "--apply"], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  const stub = join(dir, "dotclaude", "statusline.mjs");
  const out = () =>
    Bun.spawnSync(["bun", stub], { stdin: Buffer.from("{}") })
      .stdout.toString()
      .trim();
  expect(out()).toBe("newest");
  rmSync(join(versions, "0.10.0"), { recursive: true });
  expect(out()).not.toBe("orphaned");
});

test("the preview shows the detected plan, and --plan overrides it", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-plan-"));
  writeFileSync(
    join(dir, ".claude.json"),
    JSON.stringify({
      oauthAccount: {
        organizationType: "claude_max",
        organizationRateLimitTier: "default_claude_max_20x",
      },
    }),
  );
  expect(run("settings.mjs", dir).out).toContain(
    "Plan: Claude Max 20x (max20, detected)",
  );
  expect(run("settings.mjs", dir, "--plan", "pro").out).toContain(
    "Plan: Claude Pro (pro, from --plan)",
  );
  expect(run("settings.mjs", dir, "--plan", "nope").code).toBe(2);
});

test("a profile's plan overrides apply only to that plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-over-"));
  const profile = join(dir, "profile.json");
  writeFileSync(
    profile,
    JSON.stringify({
      autoCompactWindow: 150000,
      env: { A: "1" },
      plans: { pro: { autoCompactWindow: 100000, env: { B: "2" } } },
    }),
  );
  const own = (plan) => {
    run("settings.mjs", dir, "--profile", profile, "--plan", plan, "--apply");
    const s = settingsOf(dir);
    rmSync(join(dir, "settings.json"));
    return s;
  };
  expect(own("pro")).toMatchObject({
    autoCompactWindow: 100000,
    env: { A: "1", B: "2" },
  });
  const max = own("max20");
  expect(max.autoCompactWindow).toBe(150000);
  expect(max.plans).toBeUndefined();
  expect(max.env.B).toBeUndefined();
});
