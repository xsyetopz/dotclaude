// install-managed.mjs, run against a temporary DOTCLAUDE_MANAGED_DIR so the
// real managed settings directory is never touched.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../skills/apply-settings-profile/scripts/install-managed.mjs",
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
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/Dry run/);
  expect(res.stdout).toMatch(/would create/);
  expect(fs.readdirSync(dir)).toStrictEqual([]);
});

test("install-managed --apply creates the drop-in, then a re-run is a no-op", () => {
  const dir = tempManaged();
  const res = run(dir, "--apply");
  expect(res.status, res.stderr).toBe(0);
  expect(JSON.parse(fs.readFileSync(dropIn(dir), "utf8"))).toStrictEqual({
    maxEffortLevel: "xhigh",
    fastMode: false,
    fastModePerSessionOptIn: true,
    availableModels: [
      "claude-opus-5-5",
      "claude-sonnet-5",
      "claude-fable-5-1",
      "claude-haiku-4-5",
    ],
  });
  expect(fs.readdirSync(path.join(dir, "managed-settings.d"))).toStrictEqual([
    "50-dotclaude.json",
  ]);
  const again = run(dir, "--apply");
  expect(again.status, again.stderr).toBe(0);
  expect(again.stdout).toMatch(/nothing to change/);
  expect(fs.readdirSync(dir)).toStrictEqual(["managed-settings.d"]);
});

test("install-managed --yes backs up a differing file outside managed-settings.d", () => {
  const dir = tempManaged();
  fs.mkdirSync(path.join(dir, "managed-settings.d"));
  fs.writeFileSync(dropIn(dir), '{"fastMode": true}\n');
  const res = run(dir, "--apply", "--yes");
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/--- current/);
  expect(JSON.parse(fs.readFileSync(dropIn(dir), "utf8")).fastMode).toBe(false);
  expect(fs.readdirSync(path.join(dir, "managed-settings.d"))).toStrictEqual([
    "50-dotclaude.json",
  ]);
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("50-dotclaude.json.dotclaude-backup-"));
  expect(backups.length).toBe(1);
  expect(!backups[0].endsWith(".json")).toBeTruthy();
  expect(fs.readFileSync(path.join(dir, backups[0]), "utf8")).toBe(
    '{"fastMode": true}\n',
  );
});

test("install-managed refuses to overwrite a differing file without a TTY or --yes", () => {
  const dir = tempManaged();
  fs.mkdirSync(path.join(dir, "managed-settings.d"));
  fs.writeFileSync(dropIn(dir), '{"fastMode": true}\n');
  const res = run(dir, "--apply");
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/--yes/);
  expect(fs.readFileSync(dropIn(dir), "utf8")).toBe('{"fastMode": true}\n');
  expect(fs.readdirSync(dir)).toStrictEqual(["managed-settings.d"]);
});

test("install-managed leaves managed-settings.json alone and names shared keys", () => {
  const dir = tempManaged();
  const base = path.join(dir, "managed-settings.json");
  const text = '{"fastMode": true, "theme": "dark"}\n';
  fs.writeFileSync(base, text);
  const res = run(dir, "--apply");
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/also sets fastMode\./);
  expect(fs.readFileSync(base, "utf8")).toBe(text);
  expect(fs.existsSync(dropIn(dir))).toBeTruthy();
});
