// The helpers of `lib/setup.mjs`,
// and runs of `skills/setup/scripts/settings.mjs` against a temporary config folder.
// The runs use `node`, as the skill does.
// They get an empty `PATH`, so that they find no `openspec`, `node`, or language server.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  backup,
  dropLegacy,
  KEEP_BACKUPS,
  launcherText,
  lspPlugins,
  mergeProfile,
  olderThan,
} from "../../plugins/dotclaude/lib/setup.mjs";

const PLUGIN = path.join(import.meta.dirname, "../../plugins/dotclaude");
const SCRIPT = path.join(PLUGIN, "skills/setup/scripts/settings.mjs");
const NODE = Bun.which("node");
const PROFILE = JSON.parse(
  fs.readFileSync(path.join(PLUGIN, "templates/settings.json"), "utf8"),
);
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "dc-setup-"));

test("mergeProfile merges objects, adds missing array entries, and replaces scalars", () => {
  const { settings, changes } = mergeProfile(
    {
      a: 1,
      env: { X: "1" },
      list: ["u"],
      availableModels: ["old"],
      keep: true,
    },
    { a: 2, env: { Y: "2" }, list: ["u", "p"], availableModels: ["new"] },
  );
  expect(settings).toEqual({
    a: 2,
    env: { X: "1", Y: "2" },
    list: ["u", "p"],
    availableModels: ["new"],
    keep: true,
  });
  expect(changes).toEqual([
    "a: 1 -> 2",
    'env.Y: (unset) -> "2"',
    'list: ["u"] -> ["u","p"]',
    'availableModels: ["old"] -> ["new"]',
  ]);
  expect(mergeProfile(settings, { a: 2 }).changes).toEqual([]);
});

test("dropLegacy removes only the values that 0.26 wrote", () => {
  const changes = [];
  expect(
    dropLegacy(
      { includeGitInstructions: false, autoCompactWindow: 90000, x: 1 },
      changes,
    ),
  ).toEqual({ autoCompactWindow: 90000, x: 1 });
  expect(changes).toEqual(["includeGitInstructions: false -> (unset)"]);
});

test("backup keeps the newest backups of a file", () => {
  const dir = tempDir();
  const file = path.join(dir, "settings.json");
  const other = path.join(dir, "other.json.dotclaude-backup-0");
  fs.writeFileSync(file, "{}");
  fs.writeFileSync(other, "");
  let last;
  for (let i = 0; i < KEEP_BACKUPS + 2; i++)
    last = backup(file, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
  expect(last.deleted).toHaveLength(1);
  expect(fs.existsSync(last.made)).toBe(true);
  const left = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("settings.json."));
  expect(left).toHaveLength(KEEP_BACKUPS);
  expect(left.sort().at(-1)).toBe(path.basename(last.made));
  expect(fs.existsSync(other)).toBe(true);
  fs.rmSync(dir, { recursive: true });
});

test("launcherText runs the newest version in the cache that is not orphaned", () => {
  const dir = tempDir();
  const versions = path.join(dir, "cache/dotclaude");
  for (const [v, orphaned] of [
    ["0.9.0", false],
    ["0.27.0", false],
    ["0.28.0", true],
  ]) {
    const sl = path.join(versions, v, "status-line");
    fs.mkdirSync(sl, { recursive: true });
    fs.writeFileSync(path.join(sl, "statusline.mjs"), `console.log("${v}");`);
    if (orphaned) fs.writeFileSync(path.join(versions, v, ".orphaned_at"), "");
  }
  const launcher = path.join(dir, "launcher.mjs");
  fs.writeFileSync(
    launcher,
    launcherText(path.join(versions, "0.9.0/status-line/statusline.mjs")),
  );
  const out = Bun.spawnSync([NODE, launcher]).stdout.toString();
  expect(out.trim()).toBe("0.27.0");
  fs.rmSync(dir, { recursive: true });
});

test("lspPlugins lists the official plugins whose servers are all on PATH", () => {
  const marketplace = {
    plugins: [
      { name: "ts-lsp", lspServers: { ts: { command: "tsserver" } } },
      { name: "rust-lsp", lspServers: { r: { command: "rust-analyzer" } } },
      { name: "py-lsp", lspServers: { p: { command: "pyright" } } },
      { name: "docs" },
    ],
  };
  const which = (bin) => bin !== "rust-analyzer";
  expect(
    lspPlugins(
      which,
      marketplace,
      { plugins: { "py-lsp@claude-plugins-official": [] } },
      { "ts-lsp@claude-plugins-official": false },
    ),
  ).toEqual([
    "/plugin install ts-lsp@claude-plugins-official",
    "/plugin enable py-lsp@claude-plugins-official",
  ]);
});

test("olderThan compares version numbers", () => {
  expect(olderThan("1.9.0", "1.14.0")).toBe(true);
  expect(olderThan("1.14.1", "1.14.0")).toBe(false);
  expect(olderThan("20.19.0", "20.19.0")).toBe(false);
});

/** One run of the setup script with `config` as `CLAUDE_CONFIG_DIR`. */
function setup(config, ...args) {
  const r = Bun.spawnSync([NODE, SCRIPT, ...args], {
    env: {
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_PROJECT_DIR: config,
      PATH: "",
    },
  });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}
const settingsOf = (config) =>
  JSON.parse(fs.readFileSync(path.join(config, "settings.json"), "utf8"));
const hasStub = (config) =>
  fs.existsSync(path.join(config, "dotclaude/statusline.mjs"));

test("setup writes nothing without --apply, then writes the profile once", () => {
  const config = tempDir();
  const dry = setup(config);
  expect(dry.code).toBe(0);
  expect(dry.out).toContain("Dry run.");
  expect(dry.out).toContain("openspec: not found");
  expect(fs.existsSync(path.join(config, "settings.json"))).toBe(false);

  expect(setup(config, "--apply").code).toBe(0);
  const s = settingsOf(config);
  expect(mergeProfile(s, PROFILE).changes).toEqual([]);
  expect(s.statusLine.command).toContain(path.join(config, "dotclaude"));
  expect(hasStub(config)).toBe(true);

  const again = setup(config, "--apply");
  expect(again.out).toContain("Settings match the profile.");
  const backups = fs.readdirSync(config).filter((f) => f.includes("backup"));
  expect(backups).toEqual([]);
  fs.rmSync(config, { recursive: true });
});

test("setup removes what 0.26 wrote, and keeps the rest of the user files", () => {
  const config = tempDir();
  const stubDir = path.join(config, "dotclaude");
  const claudeMd = path.join(config, "CLAUDE.md");
  fs.mkdirSync(stubDir);
  fs.writeFileSync(path.join(stubDir, "subagents.mjs"), "");
  fs.writeFileSync(
    path.join(config, "settings.json"),
    JSON.stringify({
      includeGitInstructions: false,
      autoCompactWindow: 150000,
      advisorModel: "claude-opus-5-5",
      subagentStatusLine: {
        type: "command",
        command: `bun ${stubDir}/subagents.mjs`,
      },
      theme: "dark",
    }),
  );
  fs.writeFileSync(
    claudeMd,
    "# Mine\n<!-- dotclaude:begin v0.26 -->\nold\n<!-- dotclaude:end -->\nkept\n",
  );
  const run = setup(config, "--apply");
  expect(run.code).toBe(0);
  const s = settingsOf(config);
  expect(s.includeGitInstructions).toBeUndefined();
  expect(s.autoCompactWindow).toBeUndefined();
  expect(s.advisorModel).toBeUndefined();
  expect(s.subagentStatusLine).toBeUndefined();
  expect(s.theme).toBe("dark");
  expect(fs.existsSync(path.join(stubDir, "subagents.mjs"))).toBe(false);
  expect(fs.readFileSync(claudeMd, "utf8")).toBe("# Mine\nkept\n");
  expect(run.out).toContain("Backup:");
  fs.rmSync(config, { recursive: true });
});

test("setup keeps a status line of another tool unless --status-line is given", () => {
  const config = tempDir();
  const theirs = { type: "command", command: "other-tool status" };
  fs.writeFileSync(
    path.join(config, "settings.json"),
    JSON.stringify({ statusLine: theirs }),
  );
  expect(setup(config, "--apply").out).toContain("Kept your statusLine");
  expect(settingsOf(config).statusLine).toEqual(theirs);
  expect(hasStub(config)).toBe(false);

  setup(config, "--apply", "--status-line");
  expect(settingsOf(config).statusLine.command).toContain("dotclaude");
  expect(hasStub(config)).toBe(true);
  fs.rmSync(config, { recursive: true });
});

test("setup stops on a settings file that is not JSON", () => {
  const config = tempDir();
  const file = path.join(config, "settings.json");
  fs.writeFileSync(file, "{ bad");
  const run = setup(config, "--apply");
  expect(run.code).toBe(1);
  expect(run.out).toContain("Nothing changed.");
  expect(fs.readFileSync(file, "utf8")).toBe("{ bad");
  fs.rmSync(config, { recursive: true });
});
