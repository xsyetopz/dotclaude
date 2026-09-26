// install-managed.mjs, run against a temporary DOTCLAUDE_MANAGED_DIR so the
// real managed settings directory is never touched.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../skills/apply-settings-profile/scripts/install-managed.mjs",
);

function tempManaged() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-managed-"));
}

function run(dir, ...args) {
  return spawnSync("bun", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, DOTCLAUDE_MANAGED_DIR: dir },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const dropIn = (dir) =>
  path.join(dir, "managed-settings.d", "50-dotclaude.json");

test("install-managed dry run writes nothing", () => {
  const dir = tempManaged();
  const res = run(dir);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Dry run/);
  assert.match(res.stdout, /would create/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("install-managed --apply creates the drop-in, then a re-run is a no-op", () => {
  const dir = tempManaged();
  const res = run(dir, "--apply");
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(dropIn(dir), "utf8")), {
    maxEffortLevel: "xhigh",
    fastMode: false,
    fastModePerSessionOptIn: true,
    availableModels: [
      "claude-opus-5-5",
      "claude-fable-5-1",
      "claude-haiku-4-5",
    ],
  });
  assert.deepEqual(fs.readdirSync(path.join(dir, "managed-settings.d")), [
    "50-dotclaude.json",
  ]);
  const again = run(dir, "--apply");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /nothing to change/);
  assert.deepEqual(fs.readdirSync(dir), ["managed-settings.d"]);
});

test("install-managed --yes backs up a differing file outside managed-settings.d", () => {
  const dir = tempManaged();
  fs.mkdirSync(path.join(dir, "managed-settings.d"));
  fs.writeFileSync(dropIn(dir), '{"fastMode": true}\n');
  const res = run(dir, "--apply", "--yes");
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /--- current/);
  assert.equal(
    JSON.parse(fs.readFileSync(dropIn(dir), "utf8")).fastMode,
    false,
  );
  assert.deepEqual(fs.readdirSync(path.join(dir, "managed-settings.d")), [
    "50-dotclaude.json",
  ]);
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("50-dotclaude.json.dotclaude-backup-"));
  assert.equal(backups.length, 1);
  assert.ok(!backups[0].endsWith(".json"));
  assert.equal(
    fs.readFileSync(path.join(dir, backups[0]), "utf8"),
    '{"fastMode": true}\n',
  );
});

test("install-managed refuses to overwrite a differing file without a TTY or --yes", () => {
  const dir = tempManaged();
  fs.mkdirSync(path.join(dir, "managed-settings.d"));
  fs.writeFileSync(dropIn(dir), '{"fastMode": true}\n');
  const res = run(dir, "--apply");
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--yes/);
  assert.equal(fs.readFileSync(dropIn(dir), "utf8"), '{"fastMode": true}\n');
  assert.deepEqual(fs.readdirSync(dir), ["managed-settings.d"]);
});

test("install-managed leaves managed-settings.json alone and names shared keys", () => {
  const dir = tempManaged();
  const base = path.join(dir, "managed-settings.json");
  const text = '{"fastMode": true, "theme": "dark"}\n';
  fs.writeFileSync(base, text);
  const res = run(dir, "--apply");
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /also sets fastMode\./);
  assert.equal(fs.readFileSync(base, "utf8"), text);
  assert.ok(fs.existsSync(dropIn(dir)));
});
