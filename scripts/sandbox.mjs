#!/usr/bin/env bun
// Run Claude Code with this checkout as its plugin, in a config directory
// apart from your own, so a test of the plugin cannot change your settings,
// sessions, or installed plugins.
//
//   bun scripts/sandbox.mjs [claude arguments...]   set up, then run claude
//   bun scripts/sandbox.mjs --clean                 remove the sandbox
//
// DOTCLAUDE_SANDBOX sets the sandbox directory (default: dotclaude-sandbox in
// the system temp folder). It holds `config/` (CLAUDE_CONFIG_DIR) and
// `project/`, an empty git repository that is the working directory, and
// `home/`, the HOME of claude, so that setup scripts that change shell startup
// files change only the sandbox. The
// config skips onboarding and trusts the project, and has the dotclaude
// status line installed.
//
// Login: the sandbox uses CLAUDE_CODE_OAUTH_TOKEN when it is set. If not, it
// reads your own login token (the macOS Keychain entry, or
// ~/.claude/.credentials.json) and gives it to claude in its environment
// only. The token is not written to disk or printed. CLAUDE_BIN sets the
// claude executable when `claude` on PATH is not it (for example, a shell
// function).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "..");
const root = path.resolve(
  process.env.DOTCLAUDE_SANDBOX || path.join(os.tmpdir(), "dotclaude-sandbox"),
);
const config = path.join(root, "config");
const project = path.join(root, "project");
const home = path.join(root, "home");
const args = process.argv.slice(2);

if (args[0] === "--clean") {
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`Removed ${root}`);
  process.exit(0);
}

function loginToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
    return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  let text = null;
  if (process.platform === "darwin") {
    const r = spawnSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8" },
    );
    if (r.status === 0) text = r.stdout;
  }
  if (!text) {
    try {
      text = fs.readFileSync(
        path.join(os.homedir(), ".claude", ".credentials.json"),
        "utf8",
      );
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(text).claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

// Variables that the parent Claude Code session sets for its own tools. In the
// sandbox they would join the parent session or fake its state.
const SESSION_VARS = new Set([
  "CLAUDECODE",
  "AI_AGENT",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_ENV_FILE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SSE_PORT",
]);
const SESSION_PREFIXES = [
  "CLAUDE_CODE_SESSION_",
  "CLAUDE_CODE_MESSAGING_",
  "CLAUDE_PLUGIN_",
];

/**
 * The environment without the parent session's variables, and without each
 * variable that has the value your own settings `env` gives it. A value that
 * you set for the sandbox on the command line stays.
 */
function cleanEnv() {
  const own = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "settings.json",
  );
  let settingsEnv = {};
  try {
    settingsEnv = JSON.parse(fs.readFileSync(own, "utf8")).env ?? {};
  } catch {}
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      SESSION_VARS.has(name) ||
      SESSION_PREFIXES.some((p) => name.startsWith(p)) ||
      (Object.hasOwn(settingsEnv, name) &&
        String(settingsEnv[name]) === env[name])
    )
      delete env[name];
  }
  return env;
}

function setUp() {
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  if (!fs.existsSync(path.join(project, ".git"))) {
    fs.mkdirSync(project, { recursive: true });
    spawnSync("git", ["init", "-q", project]);
  }
  const state = path.join(config, ".claude.json");
  let json = {};
  try {
    json = JSON.parse(fs.readFileSync(state, "utf8"));
  } catch {
    json = {};
  }
  json.hasCompletedOnboarding = true;
  json.theme ??= "dark";
  json.projects ??= {};
  // macOS resolves /tmp and /var to /private, and the trust key is the
  // resolved path.
  for (const dir of new Set([project, fs.realpathSync(project)]))
    json.projects[dir] = {
      ...json.projects[dir],
      hasTrustDialogAccepted: true,
    };
  fs.writeFileSync(state, JSON.stringify(json, null, 2));
  if (!fs.existsSync(path.join(config, "dotclaude", "statusline.mjs")))
    spawnSync(
      "bun",
      [path.join(REPO, "skills/setup/scripts/apply-statusline.mjs"), "--apply"],
      { env: { ...process.env, CLAUDE_CONFIG_DIR: config }, stdio: "ignore" },
    );
}

setUp();
const claude = process.env.CLAUDE_BIN || Bun.which("claude");
if (!claude) {
  console.error(
    "claude is not on PATH. Set CLAUDE_BIN to the claude executable.",
  );
  process.exit(1);
}
// The token is read above with the real HOME. Only the child gets the sandbox
// HOME, without the variables that point back to the real shell files.
const env = { ...cleanEnv(), CLAUDE_CONFIG_DIR: config, HOME: home };
delete env.ZDOTDIR;
delete env.XDG_CONFIG_HOME;
const token = loginToken();
if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
else console.error("No login token found. Run /login inside the sandbox.");
const pluginDirs = [REPO, path.join(REPO, "plugins", "dotclaude-browser")];
const r = spawnSync(
  claude,
  [...pluginDirs.flatMap((dir) => ["--plugin-dir", dir]), ...args],
  {
    cwd: project,
    env,
    stdio: "inherit",
  },
);
process.exit(r.status ?? 1);
