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
