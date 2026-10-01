// install-managed.mjs, run against a temporary DOTCLAUDE_MANAGED_DIR so the
// real managed settings directory is never touched.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MIN_CLAUDE_CODE } from "../../hooks/lib/_version.mjs";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../skills/setup/scripts/install-managed.mjs",
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
  expect(res.stdout).toContain(dropIn(dir));
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
      "claude-sonnet-5-5",
      "claude-fable-5-1",
      "claude-haiku-4-5",
    ],
  });
  expect(fs.readdirSync(path.join(dir, "managed-settings.d"))).toStrictEqual([
    "50-dotclaude.json",
  ]);
  const before = fs.statSync(dropIn(dir));
  const bytes = fs.readFileSync(dropIn(dir), "utf8");
  const again = run(dir, "--apply");
  expect(again.status, again.stderr).toBe(0);
  const after = fs.statSync(dropIn(dir));
  expect(fs.readFileSync(dropIn(dir), "utf8")).toBe(bytes);
  expect(after.ino).toBe(before.ino);
  expect(after.mtimeMs).toBe(before.mtimeMs);
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
  // Output that names the base file names the shared key, not the other one.
  const mentions = (out) => out.split("\n").filter((l) => l.includes(base));
  expect(mentions(res.stdout).join("\n")).toContain("fastMode");
  expect(mentions(res.stdout).join("\n")).not.toContain("theme");
  expect(fs.readFileSync(base, "utf8")).toBe(text);
  expect(fs.existsSync(dropIn(dir))).toBeTruthy();

  // With no shared key, the output does not name the base file.
  const other = tempManaged();
  const otherBase = path.join(other, "managed-settings.json");
  fs.writeFileSync(otherBase, '{"theme": "dark"}\n');
  const quiet = run(other);
  expect(quiet.status, quiet.stderr).toBe(0);
  expect(quiet.stdout).not.toContain(otherBase);
});

test("install-managed --org adds the organization keys to the lock", () => {
  const dir = tempManaged();
  const res = run(dir, "--org", "--apply");
  expect(res.status, res.stderr).toBe(0);
  const written = JSON.parse(fs.readFileSync(dropIn(dir), "utf8"));
  expect(written.fastMode).toBe(false);
  expect(written.enforceAvailableModels).toBe(true);
  expect(written.requiredMinimumVersion).toBe(MIN_CLAUDE_CODE);
  expect(written.enabledPlugins).toStrictEqual({ "dotclaude@dotclaude": true });
  // Declaring the marketplace source keeps the setup skill's allowed-tools
  // under allowManagedPermissionRulesOnly.
  expect(written.extraKnownMarketplaces).toStrictEqual({
    dotclaude: { source: { source: "github", repo: "xsyetopz/dotclaude" } },
  });
  // An allowlist that names only dotclaude would block every other
  // marketplace of the organization, so the drop-in sets none.
  expect(written).not.toHaveProperty("strictKnownMarketplaces");

  // The personal lock stays without the organization keys.
  const personal = tempManaged();
  expect(run(personal, "--apply").status).toBe(0);
  const own = JSON.parse(fs.readFileSync(dropIn(personal), "utf8"));
  expect(own).not.toHaveProperty("enabledPlugins");
  expect(own).not.toHaveProperty("requiredMinimumVersion");
});
