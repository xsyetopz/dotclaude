#!/usr/bin/env bun
// Report which optional integrations are installed and configured, as JSON.
//
//   bun status.mjs [--project <dir>]
//
// Reads only: PATH, ~/.claude.json and the project's .mcp.json (MCP server
// names, never their env or headers), the project's .codegraph/ and .tgrep/
// directories, whether the global git excludes file lists .tgrep/, and for
// fast-compact whether the plugin is installed and which settings are
// present (key names only, never values), and the gitleaks version.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

/** The global git excludes file, as git resolves it. */
function globalIgnore() {
  const res = spawnSync("git", ["config", "--global", "core.excludesFile"], {
    encoding: "utf8",
  });
  const set = (res.stdout ?? "").trim().replace(/^~(?=\/)/, home);
  const file =
    set ||
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
      "git",
      "ignore",
    );
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  return { file, lists_tgrep: /^\/?\.tgrep\/?$/m.test(text) };
}

/** fast-compact: plugin installed, function hooks on, which Jev key exists. */
function fastCompact() {
  const settings = readJson(path.join(home, ".claude", "settings.json")) ?? {};
  const env = { ...settings.env, ...process.env };
  const plugins = readJson(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
  );
  const installed = Object.keys(plugins?.plugins ?? {}).some((id) =>
    id.startsWith("fast-compact@"),
  );
  const config = settings.pluginConfigs?.["fast-compact@fast-compact"] ?? {};
  return {
    installed,
    function_hooks: env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS === "1",
    keys: ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"].filter((k) => env[k]),
    provider: config.options?.provider ?? null,
  };
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
      tgrep: {
        cli: version("tgrep"),
        indexed: fs.existsSync(path.join(project, ".tgrep")),
        global_ignore: globalIgnore(),
      },
      fast_compact: fastCompact(),
      gitleaks: { cli: version("gitleaks", "version") },
      headroom: {
        cli: version("headroom"),
        mcp: servers.get("headroom") ?? null,
        proxy:
          baseUrl && /127\.0\.0\.1:8787|localhost:8787/.test(baseUrl)
            ? baseUrl
            : null,
      },
    },
    null,
    2,
  ),
);
