import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = new URL("../skills/setup/scripts/", import.meta.url).pathname;
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
  expect(JSON.stringify(PROFILE)).not.toMatch(/fable/i);
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
