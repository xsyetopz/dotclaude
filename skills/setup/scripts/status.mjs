#!/usr/bin/env bun
// Report which optional integrations are installed and configured, as JSON.
//
//   bun status.mjs [--project <dir>]
//
// Reads only: PATH, ~/.claude.json and the project's .mcp.json (MCP server
// names, never their env or headers), the project's .codegraph/ and .tgrep/
// directories, whether the global git excludes file lists .tgrep/, the
// betterleaks and semlf versions, and for Ghidra the versions of `uvx`, Python,
// and Java, `GHIDRA_INSTALL_DIR`, the
// `ghidra` MCP entry, and the `ghidra-bridge` CLI. For dotclaude-browser it
// reads whether the plugin, agent-browser, CloakBrowser, ddddocr, and the
// ddddocr model are installed. For OpenSpec it reads the CLI version and
// whether the project has `openspec/config.yaml` and `openspec-*` skills.

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
// Claude Code keeps its config, and `.claude.json`, in CLAUDE_CONFIG_DIR when
// it is set.
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
const stateFile = process.env.CLAUDE_CONFIG_DIR
  ? path.join(configDir, ".claude.json")
  : path.join(home, ".claude.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** MCP server names configured for Claude Code at user, local, or project scope. */
function mcpServers() {
  const claude = readJson(stateFile) ?? {};
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

/** Whether a plugin with this name is installed from any marketplace. */
function pluginInstalled(name) {
  const plugins = readJson(
    path.join(configDir, "plugins", "installed_plugins.json"),
  );
  return Object.keys(plugins?.plugins ?? {}).some((id) =>
    id.startsWith(`${name}@`),
  );
}

/**
 * dotclaude-browser: the plugin, the agent-browser CLI, CloakBrowser as a
 * global bun package, and the ddddocr CLI with its model file.
 */
function browser() {
  const models = [
    process.env.DDDDOCR_MODEL_PATH,
    path.join(home, ".local/share/ddddocr/ddddocr.onnx"),
    path.join(home, ".ddddocr/ddddocr.onnx"),
    "/usr/local/share/ddddocr/ddddocr.onnx",
  ].filter(Boolean);
  const bunGlobal =
    process.env.BUN_INSTALL_GLOBAL_DIR ||
    path.join(
      process.env.BUN_INSTALL || path.join(home, ".bun"),
      "install",
      "global",
    );
  return {
    installed: pluginInstalled("dotclaude-browser"),
    agent_browser: version("agent-browser"),
    cloakbrowser: fs.existsSync(
      path.join(bunGlobal, "node_modules", "cloakbrowser"),
    ),
    ddddocr: Bun.which("ddddocr") ?? Bun.which("ddddocr-cli") ?? null,
    ddddocr_model: models.find((m) => fs.existsSync(m)) ?? null,
  };
}

/** The version that `bin` prints, and whether its major and minor pass. */
function runtime(bin, flag, pattern, [major, minor]) {
  if (!Bun.which(bin)) return null;
  const res = spawnSync(bin, [flag], { encoding: "utf8", timeout: 5000 });
  const found = pattern.exec(`${res.stdout ?? ""}${res.stderr ?? ""}`);
  if (!found) return { version: null, ok: false };
  const [a, b = 0] = found[1].split(".").map(Number);
  return { version: found[1], ok: a > major || (a === major && b >= minor) };
}

/**
 * Ghidra: the MCP server `pyghidra-mcp` runs through `uvx` on Python 3.10 or
 * newer, and Ghidra itself needs Java 21. The `ghidra-bridge` CLI is the
 * fallback when the MCP server is missing or fails.
 */
function ghidra(servers) {
  const dir = process.env.GHIDRA_INSTALL_DIR || null;
  const bridge = Bun.which("ghidra-bridge");
  return {
    uvx: version("uvx"),
    python: runtime(
      "python3",
      "--version",
      /Python (\d+\.\d+(?:\.\d+)?)/,
      [3, 10],
    ),
    java: runtime("java", "-version", /version "(\d+(?:\.\d+)*)/, [21, 0]),
    install_dir: dir,
    headless:
      dir !== null &&
      fs.existsSync(path.join(dir, "support", "analyzeHeadless")),
    mcp: servers.get("ghidra") ?? null,
    bridge: bridge ?? null,
  };
}

/**
 * OpenSpec: the CLI, and whether the project has the files that
 * `openspec init --tools claude` writes.
 */
function openspec() {
  let skills = false;
  try {
    skills = fs
      .readdirSync(path.join(project, ".claude", "skills"))
      .some((name) => name.startsWith("openspec-"));
  } catch {
    skills = false;
  }
  return {
    cli: version("openspec"),
    initialized: fs.existsSync(path.join(project, "openspec", "config.yaml")),
    claude_skills: skills,
  };
}

const servers = mcpServers();
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
      betterleaks: { cli: version("betterleaks", "version") },
      semlf: { cli: version("semlf") },
      ghidra: ghidra(servers),
      browser: browser(),
      openspec: openspec(),
    },
    null,
    2,
  ),
);
