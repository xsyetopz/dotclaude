// setup-integrations status.mjs, run against a temporary HOME.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempHome, writeModelCache } from "../support/setup.mjs";

test("setup-integrations status reports MCP servers, index, and Codex profiles", () => {
  const home = tempHome();
  const project = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-proj-")),
  );
  fs.mkdirSync(path.join(project, ".codegraph"));
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { headroom: { command: "headroom", env: { SECRET: "x" } } },
      projects: { [project]: { mcpServers: { codegraph: {} } } },
    }),
  );
  fs.mkdirSync(path.join(home, ".codex"));
  fs.writeFileSync(
    path.join(home, ".codex", "config.toml"),
    'model = "gpt-6-luna"\nservice_tier = "default"\n[features]\nfast_mode = false\n[profiles.dotclaude-luna]\nmodel = "gpt-6-luna"\n',
  );
  writeModelCache(path.join(home, ".codex"), "2026-01-02T03:04:05Z");
  fs.writeFileSync(
    path.join(home, ".codex", "dotclaude-catalog-worker.json"),
    "{}",
  );
  const claims = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_plan_type: "plus" },
    }),
  ).toString("base64url");
  fs.writeFileSync(
    path.join(home, ".codex", "auth.json"),
    JSON.stringify({
      tokens: { id_token: `h.${claims}.sig`, access_token: "SECRET-TOKEN" },
    }),
  );
  const res = spawnSync(
    "bun",
    [
      path.resolve(
        import.meta.dirname,
        "../../skills/setup-integrations/scripts/status.mjs",
      ),
      "--project",
      project,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, HOME: home, PATH: path.dirname(process.execPath) },
    },
  );
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).not.toMatch(/SECRET/);
  expect(JSON.parse(res.stdout).codex.plan).toBe("plus");
  const status = JSON.parse(res.stdout);
  expect(status.codegraph.mcp).toBe("local");
  expect(status.codegraph.indexed).toBe(true);
  expect(status.headroom.mcp).toBe("user");
  expect(status.codex.cli).toBe(null);
  expect(status.codex.config.service_tier).toBe("default");
  expect(status.codex.config.fast_mode).toBe(false);
  expect(status.codex.config.legacy_profile_tables).toStrictEqual([
    "dotclaude-luna",
  ]);
  expect(status.codex.catalogs).toStrictEqual({
    interactive: false,
    worker: true,
    review: false,
  });
  expect(status.codex.models_cache_fetched_at).toBe("2026-01-02T03:04:05Z");
});
