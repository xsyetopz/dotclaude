// dotclaude-browser: the plugin has no hooks,
// and the skill reads the backend option through `${user_config.backend}`.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "../../plugins/dotclaude-browser");

test("the plugin has no hooks", () => {
  expect(fs.existsSync(path.join(ROOT, "hooks"))).toBe(false);
});

test("the skill names the backend option that the manifest declares", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf8"),
  );
  const skill = fs.readFileSync(
    path.join(ROOT, "skills/drive-web-browser/SKILL.md"),
    "utf8",
  );
  expect(manifest.userConfig.backend).toBeDefined();
  expect(skill).toContain("$" + "{user_config.backend}");
});
