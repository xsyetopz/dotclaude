// Shared helpers for the setup script tests, which run against a temporary HOME
// so real settings are never touched.

import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SKILL = path.resolve(import.meta.dirname, "../../skills/setup");
export const SCRIPTS = path.join(SKILL, "scripts");
export const FIXTURES = path.resolve(import.meta.dirname, "../setup/fixtures");

export function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-home-"));
  fs.mkdirSync(path.join(home, ".claude"));
  return home;
}

/**
 * Run a setup script with HOME at `home`. `env` overrides the defaults: the
 * plan comes from the temp HOME's .claude.json, and the running Claude Code
 * is the tested release, so the machine that runs the tests decides nothing.
 */
export function runWith(env, script, home, ...args) {
  const res = spawnSync("bun", [path.join(SCRIPTS, script), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: "",
      ZDOTDIR: "",
      XDG_CONFIG_HOME: "",
      AI_AGENT: "claude-code_2-1-286_agent",
      CLAUDE_CODE_EXECPATH: "",
      ...env,
    },
  });
  expect(res.status, res.stderr).toBe(0);
  return res.stdout;
}

export const run = (script, home, ...args) =>
  runWith({}, script, home, ...args);

/** The backups a script made next to `file`. */
export const backups = (file) =>
  fs
    .readdirSync(path.dirname(file))
    .filter((f) => f.startsWith(`${path.basename(file)}.dotclaude-backup-`));
