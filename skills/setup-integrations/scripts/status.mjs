#!/usr/bin/env bun
// Report which optional integrations are installed and configured, as JSON.
//
//   bun status.mjs [--project <dir>] [--codex]
//
// --codex prints one compact line with only the Codex fields.
//
// Reads only: PATH, ~/.claude.json and the project's .mcp.json (MCP server
// names, never their env or headers), $CODEX_HOME/config.toml and profile
// files, which dotclaude model catalogs exist and the model cache's
// fetched_at, the ChatGPT plan claim from the Codex login (never the tokens),
// and the project's .codegraph/ directory.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexHome, codexPlan } from "../../../hooks/lib/_codex.mjs";
import { AUDIENCES, catalogPath } from "./build-codex-catalog.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--project");
const project = path.resolve(
  at >= 0 && args[at + 1]
    ? args[at + 1]
    : process.env.CLAUDE_PROJECT_DIR || process.cwd(),
);
const home = os.homedir();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** MCP server names configured for Claude Code at user, local, or project scope. */
function mcpServers() {
  const claude = readJson(path.join(home, ".claude.json")) ?? {};
  const names = new Map();
  for (const name of Object.keys(claude.mcpServers ?? {}))
    names.set(name, "user");
  for (const name of Object.keys(claude.projects?.[project]?.mcpServers ?? {}))
    names.set(name, "local");
  const shared = readJson(path.join(project, ".mcp.json"));
  for (const name of Object.keys(shared?.mcpServers ?? {}))
    names.set(name, "project");
  return names;
}

function version(bin, flag = "--version") {
  if (!Bun.which(bin)) return null;
  const res = spawnSync(bin, [flag], { encoding: "utf8", timeout: 5000 });
  return (res.stdout || res.stderr || "").trim().split("\n")[0] || "unknown";
}

/** Which dotclaude catalogs exist, and when Codex last fetched its model list. */
function codexCatalogs() {
  return {
    catalogs: Object.fromEntries(
      AUDIENCES.map((a) => [a, fs.existsSync(catalogPath(codexHome(), a))]),
    ),
    models_cache_fetched_at:
      readJson(path.join(codexHome(), "models_cache.json"))?.fetched_at ?? null,
  };
}

function codexConfig() {
  const file = path.join(codexHome(), "config.toml");
  if (!fs.existsSync(file)) return { file, exists: false };
  try {
    const config = Bun.TOML.parse(fs.readFileSync(file, "utf8"));
    return {
      file,
      exists: true,
      model: config.model ?? null,
      model_catalog_json: config.model_catalog_json ?? null,
      service_tier: config.service_tier ?? null,
      fast_mode: config.features?.fast_mode ?? null,
      legacy_profile_tables: Object.keys(config.profiles ?? {}),
      dotclaude_profiles: ["dotclaude-luna", "dotclaude-review"].filter(
        (name) => fs.existsSync(path.join(codexHome(), `${name}.config.toml`)),
      ),
    };
  } catch (err) {
    return { file, exists: true, error: `not valid TOML: ${err.message}` };
  }
}

function codexLogin() {
  if (!Bun.which("codex")) return null;
  const res = spawnSync("codex", ["login", "status"], {
    encoding: "utf8",
    timeout: 10000,
  });
  return (res.stdout || res.stderr || "").trim().split("\n")[0] || null;
}

if (args.includes("--codex")) {
  const config = codexConfig();
  console.log(
    JSON.stringify({
      cli: version("codex"),
      login: codexLogin(),
      plan: codexPlan(),
      profiles: {
        worker: fs.existsSync(
          path.join(codexHome(), "dotclaude-luna.config.toml"),
        ),
        review: fs.existsSync(
          path.join(codexHome(), "dotclaude-review.config.toml"),
        ),
      },
      service_tier: config.service_tier ?? null,
      fast_mode: config.fast_mode ?? null,
      ...codexCatalogs(),
    }),
  );
  process.exit(0);
}

const servers = mcpServers();
const baseUrl = process.env.ANTHROPIC_BASE_URL ?? null;
console.log(
  JSON.stringify(
    {
      project,
      codegraph: {
        cli: version("codegraph"),
        mcp: servers.get("codegraph") ?? null,
        indexed: fs.existsSync(path.join(project, ".codegraph")),
      },
      headroom: {
        cli: version("headroom"),
        mcp: servers.get("headroom") ?? null,
        proxy:
          baseUrl && /127\.0\.0\.1:8787|localhost:8787/.test(baseUrl)
            ? baseUrl
            : null,
      },
      codex: {
        cli: version("codex"),
        login: codexLogin(),
        plan: codexPlan(),
        config: codexConfig(),
        ...codexCatalogs(),
      },
    },
    null,
    2,
  ),
);
