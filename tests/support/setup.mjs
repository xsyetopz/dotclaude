// Shared helpers for the setup script tests, which run against a temporary HOME
// so real settings are never touched.

import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCRIPTS = path.resolve(
  import.meta.dirname,
  "../../skills/apply-settings-profile/scripts",
);

export function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-home-"));
  fs.mkdirSync(path.join(home, ".claude"));
  return home;
}

export const SETUP = path.resolve(
  import.meta.dirname,
  "../../skills/setup-integrations",
);

export function run(script, home, ...args) {
  const res = spawnSync("bun", [path.join(SCRIPTS, script), ...args], {
    encoding: "utf8",
    // The plan comes from the temp HOME's .claude.json, not the real one.
    env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: "" },
  });
  expect(res.status, res.stderr).toBe(0);
  return res.stdout;
}
