// migrate.mjs removes what 0.16.x installed outside the settings file: the
// `claude` shell function and its system-prompt copy. Run against a temp HOME.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  backups,
  FIXTURES,
  run,
  runWith,
  tempHome,
} from "../support/setup.mjs";

const OLD = path.join(FIXTURES, "0.16.1");
const USER_LINES = 'export PATH="$HOME/bin:$PATH"\nalias ll="ls -l"\n';

/** A HOME as 0.16.1's launcher left it, for zsh and fish. */
function home016() {
  const home = tempHome();
  fs.copyFileSync(path.join(OLD, "zshrc"), path.join(home, ".zshrc"));
  const fish = path.join(home, ".config", "fish", "conf.d");
  fs.mkdirSync(fish, { recursive: true });
  fs.copyFileSync(
    path.join(OLD, "dotclaude.fish"),
    path.join(fish, "dotclaude.fish"),
  );
  const prompt = path.join(home, ".claude", "dotclaude", "system-prompt.md");
  fs.mkdirSync(path.dirname(prompt));
  fs.writeFileSync(prompt, "# old prompt\n");
  return {
    home,
    zshrc: path.join(home, ".zshrc"),
    fish: path.join(fish, "dotclaude.fish"),
    prompt,
  };
}

test("the preview names each 0.16 leftover and writes nothing", () => {
  const { home, zshrc, fish, prompt } = home016();
  const before = fs.readFileSync(zshrc, "utf8");
  const out = run("migrate.mjs", home);
  expect(out).toContain(zshrc);
  expect(out).toContain(fish);
  expect(out).toContain(prompt);
  expect(fs.readFileSync(zshrc, "utf8")).toBe(before);
  expect(fs.existsSync(fish)).toBe(true);
  expect(fs.existsSync(prompt)).toBe(true);
});

test("--apply removes the function and the prompt copy, keeps the user's lines, and a second run changes nothing", () => {
  const { home, zshrc, fish, prompt } = home016();
  const before = fs.readFileSync(zshrc, "utf8");
  run("migrate.mjs", home, "--apply");
  expect(fs.readFileSync(zshrc, "utf8")).toBe(USER_LINES);
  expect(backups(zshrc).length).toBe(1);
  expect(fs.readFileSync(path.join(home, backups(zshrc)[0]), "utf8")).toBe(
    before,
  );
  // dotclaude owned the whole fish file, so it goes.
  expect(fs.existsSync(fish)).toBe(false);
  expect(fs.existsSync(prompt)).toBe(false);

  const again = run("migrate.mjs", home, "--apply");
  expect(again).toContain("nothing to change");
  expect(fs.readFileSync(zshrc, "utf8")).toBe(USER_LINES);
  expect(backups(zshrc).length).toBe(1);
});

test("the function goes from every shell file it can be in, under ZDOTDIR and CLAUDE_CONFIG_DIR too", () => {
  const home = tempHome();
  const block = fs
    .readFileSync(path.join(OLD, "zshrc"), "utf8")
    .slice(USER_LINES.length + 1);
  const zdot = path.join(home, "zdot");
  const config = path.join(home, "config");
  const files = [
    path.join(zdot, ".zshrc"),
    path.join(home, ".bashrc"),
    path.join(home, ".bash_profile"),
    path.join(
      home,
      ".config",
      "powershell",
      "Microsoft.PowerShell_profile.ps1",
    ),
  ];
  for (const file of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `# mine\n\n${block}`);
  }
  const prompt = path.join(config, "dotclaude", "system-prompt.md");
  fs.mkdirSync(path.dirname(prompt), { recursive: true });
  fs.writeFileSync(prompt, "x");
  runWith(
    { ZDOTDIR: zdot, CLAUDE_CONFIG_DIR: config },
    "migrate.mjs",
    home,
    "--apply",
  );
  for (const file of files)
    expect(fs.readFileSync(file, "utf8"), file).toBe("# mine\n");
  expect(fs.existsSync(prompt)).toBe(false);
});

test("a HOME without 0.16 leftovers needs no change", () => {
  const home = tempHome();
  fs.writeFileSync(path.join(home, ".zshrc"), USER_LINES);
  expect(run("migrate.mjs", home, "--apply")).toContain("nothing to change");
  expect(fs.readFileSync(path.join(home, ".zshrc"), "utf8")).toBe(USER_LINES);
  expect(backups(path.join(home, ".zshrc"))).toStrictEqual([]);
});

/** The `userConfig` keys of the dotclaude manifest. */
const MANIFEST_KEYS = Object.keys(
  JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, "../../.claude-plugin/plugin.json"),
      "utf8",
    ),
  ).userConfig,
);

/** Manifest keys added after 0.16, so no 0.16 key renames to them. */
const NEW_SINCE_016 = new Set([
  "context_line_breaks",
  "context_compaction_handoff",
  "context_auto_clear",
  "notify_desktop",
]);

/** A HOME whose user settings hold 0.16 option keys for dotclaude. */
function homeWithOptions(options) {
  const home = tempHome();
  const settings = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(
    settings,
    `${JSON.stringify({ model: "opus", pluginConfigs: { "dotclaude@dotclaude": { options }, "other@x": { options: { bash_guard: true } } } }, null, 2)}\n`,
  );
  return { home, settings };
}

const OLD_OPTIONS = {
  bash_guard: false,
  edit_guard: true,
  secret_redaction: false,
  ask_in_auto_mode: true,
  stop_gate: true,
  task_check: true,
  goal_loop_guard: true,
  nested_instructions: true,
  exclude_session_files: true,
  compact_carryover: true,
  handoff_pointer: true,
  subagent_guidance: true,
  turn_limit_handoff: true,
  scratchpad_prune_days: 7,
  claude_plan: "max_20x",
  allowed_models: "claude-opus-5-5",
  commit_hygiene: true,
  model_lock: true,
  usage_notes: true,
  git_attribution: false,
};

test("--apply renames each 0.16 option key to a key the manifest declares and keeps its value", () => {
  const { home, settings } = homeWithOptions({ ...OLD_OPTIONS });
  const before = fs.readFileSync(settings, "utf8");
  const preview = run("migrate.mjs", home);
  expect(preview).toContain("claude_plan -> model_plan");
  expect(fs.readFileSync(settings, "utf8")).toBe(before);

  run("migrate.mjs", home, "--apply");
  const after = JSON.parse(fs.readFileSync(settings, "utf8"));
  const options = after.pluginConfigs["dotclaude@dotclaude"].options;
  expect(Object.keys(options).sort()).toStrictEqual(
    MANIFEST_KEYS.filter((key) => !NEW_SINCE_016.has(key)).sort(),
  );
  expect(options.guard_bash).toBe(false);
  expect(options.usage_scratchpad_prune_days).toBe(7);
  expect(options.model_plan).toBe("max_20x");
  expect(options.git_attribution).toBe(false);
  // Other plugins and other settings stay as they were.
  expect(after.pluginConfigs["other@x"].options).toStrictEqual({
    bash_guard: true,
  });
  expect(after.model).toBe("opus");
  expect(backups(settings).length).toBe(1);
  expect(run("migrate.mjs", home, "--apply")).toContain("nothing to change");
});

test("a value already set under the new key wins over the old key", () => {
  const { home, settings } = homeWithOptions({
    claude_plan: "pro",
    model_plan: "max_5x",
  });
  run("migrate.mjs", home, "--apply");
  expect(
    JSON.parse(fs.readFileSync(settings, "utf8")).pluginConfigs[
      "dotclaude@dotclaude"
    ].options,
  ).toStrictEqual({ model_plan: "max_5x" });
});
