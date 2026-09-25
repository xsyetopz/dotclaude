// Setup scripts, run against a temporary HOME so real settings are never touched.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const SCRIPTS = path.resolve(
  import.meta.dirname,
  "../skills/apply-settings-profile/scripts",
);

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-home-"));
  fs.mkdirSync(path.join(home, ".claude"));
  return home;
}

function run(script, home, ...args) {
  const res = spawnSync("bun", [path.join(SCRIPTS, script), ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

test("apply-settings previews without writing, then merges without removing user keys", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      theme: "auto",
      permissions: { allow: ["mcp__codegraph__*"], deny: ["Read(~/.ssh/**)"] },
    }),
  );
  const before = fs.readFileSync(file, "utf8");
  assert.match(run("apply-settings.mjs", home), /Dry run/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  run("apply-settings.mjs", home, "--apply");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(merged.theme, "auto");
  assert.deepEqual(merged.permissions.allow, ["mcp__codegraph__*"]);
  assert.equal(
    merged.permissions.deny.filter((r) => r === "Read(~/.ssh/**)").length,
    1,
  );
  assert.equal(merged.fastMode, false);
  assert.equal(merged.env.CLAUDE_CODE_DISABLE_FAST_MODE, "1");
  assert.ok(
    fs
      .readdirSync(path.join(home, ".claude"))
      .some((f) => f.startsWith("settings.json.dotclaude-backup-")),
  );
  assert.match(run("apply-settings.mjs", home), /Already up to date/);
});

test("apply-claude-md appends a marked section, replaces it in place, and removes it", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "CLAUDE.md");
  const source = path.join(home, "section.md");
  fs.writeFileSync(file, "## CodeGraph\n\nUser's own rules.\n");
  fs.writeFileSync(source, "First version.");
  assert.match(run("apply-claude-md.mjs", home, "--source", source), /Dry run/);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    "## CodeGraph\n\nUser's own rules.\n",
  );

  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  let text = fs.readFileSync(file, "utf8");
  assert.match(
    text,
    /^## CodeGraph\n\nUser's own rules\.\n\n<!-- dotclaude:begin/,
  );
  assert.match(text, /First version\.\n<!-- dotclaude:end -->\n$/);

  fs.writeFileSync(source, "Second version.");
  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  text = fs.readFileSync(file, "utf8");
  assert.equal(text.match(/dotclaude:begin/g).length, 1);
  assert.match(text, /Second version\./);
  assert.doesNotMatch(text, /First version/);

  run("apply-claude-md.mjs", home, "--remove", "--apply");
  assert.equal(
    fs.readFileSync(file, "utf8").trim(),
    "## CodeGraph\n\nUser's own rules.",
  );
});
