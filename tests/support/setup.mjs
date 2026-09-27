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

/** A small models_cache.json in the shape Codex writes, with the fields its catalog parser requires. */
export function modelFixture(slug, extra = {}) {
  return {
    slug,
    display_name: slug,
    description: null,
    supported_reasoning_levels: [{ effort: "low", description: "Fast" }],
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority: 1,
    availability_nux: null,
    upgrade: null,
    support_verbosity: true,
    default_verbosity: "low",
    apply_patch_tool_type: "freeform",
    truncation_policy: { mode: "tokens", limit: 10000 },
    experimental_supported_tools: [],
    ...extra,
  };
}

export function writeModelCache(dir, fetchedAt = new Date().toISOString()) {
  const cache = {
    fetched_at: fetchedAt,
    etag: 'W/"x"',
    client_version: "0.157.0",
    models: [
      modelFixture("gpt-6-luna", {
        model_messages: {
          instructions_template: "Upstream template.",
          instructions_variables: null,
          persistent_instructions: "Upstream persistent.",
          multi_agent: {
            role: { root: "Upstream root.", subagent: "Upstream subagent." },
            mode: null,
          },
        },
      }),
      modelFixture("gpt-5.5", {
        model_messages: { instructions_template: "Other model template." },
      }),
      modelFixture("codex-auto-review", { visibility: "hide" }),
    ],
  };
  fs.writeFileSync(path.join(dir, "models_cache.json"), JSON.stringify(cache));
  return cache;
}

export function run(script, home, ...args) {
  const res = spawnSync("bun", [path.join(SCRIPTS, script), ...args], {
    encoding: "utf8",
    // The plan comes from the temp HOME's .claude.json, not the real one.
    env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: "" },
  });
  expect(res.status, res.stderr).toBe(0);
  return res.stdout;
}

export function runConfigureCodex(codexHome, ...args) {
  return spawnSync(
    "bun",
    [path.join(SETUP, "scripts/configure-codex.mjs"), ...args],
    { encoding: "utf8", env: { ...process.env, CODEX_HOME: codexHome } },
  );
}
