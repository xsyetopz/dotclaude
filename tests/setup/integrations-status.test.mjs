// setup-integrations status.mjs, run against a temporary HOME.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempHome } from "../support/setup.mjs";

test("setup-integrations status reports MCP servers and index state", () => {
  const home = tempHome();
  const project = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-proj-")),
  );
  fs.mkdirSync(path.join(project, ".codegraph"));
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { other: { command: "other", env: { SECRET: "x" } } },
      projects: { [project]: { mcpServers: { codegraph: {} } } },
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
  const status = JSON.parse(res.stdout);
  expect(status.codegraph.mcp).toBe("local");
  expect(status.codegraph.indexed).toBe(true);
});

/** Run status.mjs with only the given stub programs on PATH. */
function ghidraStatus({ stubs = {}, env = {}, claude = {} } = {}) {
  const home = tempHome();
  const project = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-proj-")),
  );
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-bin-"));
  for (const [name, script] of Object.entries(stubs)) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${script}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify(claude));
  const res = spawnSync(
    process.execPath,
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
      env: { HOME: home, PATH: `${bin}:/bin:/usr/bin`, ...env },
    },
  );
  expect(res.status, res.stderr).toBe(0);
  return { ghidra: JSON.parse(res.stdout).ghidra };
}

test("status reports a complete Ghidra setup", () => {
  const ghidra = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-ghidra-"));
  fs.mkdirSync(path.join(ghidra, "support"));
  fs.writeFileSync(path.join(ghidra, "support", "analyzeHeadless"), "");
  const stubs = {
    uvx: "echo uvx 0.9.2",
    python3: "echo Python 3.12.4",
    java: "echo 'openjdk version \"21.0.5\" 2024-10-15' >&2",
    "ghidra-bridge": "echo ghidra-bridge",
  };
  const { ghidra: status } = ghidraStatus({
    stubs,
    env: { GHIDRA_INSTALL_DIR: ghidra },
    claude: { mcpServers: { ghidra: { command: "uvx" } } },
  });
  expect(status.uvx).toBe("uvx 0.9.2");
  expect(status.python).toStrictEqual({ version: "3.12.4", ok: true });
  expect(status.java).toStrictEqual({ version: "21.0.5", ok: true });
  expect(status.install_dir).toBe(ghidra);
  expect(status.headless).toBe(true);
  expect(status.mcp).toBe("user");
  expect(status.bridge).toBeTruthy();
});

test("status reports a missing Ghidra setup and an old Python or Java", () => {
  const { ghidra: missing } = ghidraStatus();
  expect(missing.uvx).toBe(null);
  expect(missing.install_dir).toBe(null);
  expect(missing.headless).toBe(false);
  expect(missing.mcp).toBe(null);
  expect(missing.bridge).toBe(null);
  const { ghidra: old } = ghidraStatus({
    stubs: {
      python3: "echo Python 3.9.6",
      java: "echo 'openjdk version \"17.0.2\" 2022-01-18' >&2",
    },
    env: { GHIDRA_INSTALL_DIR: "/nonexistent/ghidra" },
  });
  expect(old.python).toStrictEqual({ version: "3.9.6", ok: false });
  expect(old.java).toStrictEqual({ version: "17.0.2", ok: false });
  expect(old.headless).toBe(false);
});

test("status reports OpenSpec setup in the project", () => {
  const home = tempHome();
  const project = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-proj-")),
  );
  const script = path.resolve(
    import.meta.dirname,
    "../../skills/setup-integrations/scripts/status.mjs",
  );
  const status = () => {
    const res = spawnSync(process.execPath, [script, "--project", project], {
      encoding: "utf8",
      env: { HOME: home, PATH: "/bin:/usr/bin" },
    });
    expect(res.status, res.stderr).toBe(0);
    return JSON.parse(res.stdout).openspec;
  };
  expect(status()).toStrictEqual({
    cli: null,
    initialized: false,
    claude_skills: false,
  });
  fs.mkdirSync(path.join(project, "openspec"));
  fs.writeFileSync(path.join(project, "openspec", "config.yaml"), "");
  fs.mkdirSync(path.join(project, ".claude", "skills", "openspec-propose"), {
    recursive: true,
  });
  expect(status()).toMatchObject({ initialized: true, claude_skills: true });
});
