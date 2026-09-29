// The version bump keeps both manifests and the CHANGELOG in step.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nextVersion } from "../../scripts/bump-version.mjs";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../scripts/bump-version.mjs",
);

function project(pluginVersion = "0.6.0", packageVersion = pluginVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-bump-"));
  fs.mkdirSync(path.join(root, ".claude-plugin"));
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    `{\n  "name": "dotclaude",\n  "version": "${pluginVersion}",\n  "description": "x"\n}\n`,
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    `{\n  "name": "dotclaude",\n  "version": "${packageVersion}"\n}\n`,
  );
  fs.writeFileSync(
    path.join(root, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A bug.\n\n## [0.6.0] - 2026-09-27\n",
  );
  return root;
}

const bump = (root, ...args) =>
  spawnSync("bun", [SCRIPT, ...args, "--root", root], { encoding: "utf8" });
const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const FILES = [".claude-plugin/plugin.json", "package.json", "CHANGELOG.md"];
const snapshot = (root) => FILES.map((rel) => read(root, rel));

test("semver levels", () => {
  expect(nextVersion("0.6.0", "patch")).toBe("0.6.1");
  expect(nextVersion("0.6.3", "minor")).toBe("0.7.0");
  expect(nextVersion("0.6.3", "major")).toBe("1.0.0");
  expect(nextVersion("0.6.3", "2.0.0")).toBe("2.0.0");
  expect(() => nextVersion("0.6.3", "huge")).toThrow(/major, minor, patch/);
});

test("a bump rewrites both version lines and dates the Unreleased entries", () => {
  const root = project();
  const res = bump(root, "minor");
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/0\.6\.0 -> 0\.7\.0/);
  expect(read(root, ".claude-plugin/plugin.json")).toBe(
    '{\n  "name": "dotclaude",\n  "version": "0.7.0",\n  "description": "x"\n}\n',
  );
  expect(read(root, "package.json")).toMatch(/"version": "0\.7\.0"/);
  const today = new Date().toISOString().slice(0, 10);
  expect(read(root, "CHANGELOG.md")).toBe(
    `# Changelog\n\n## [Unreleased]\n\n## [0.7.0] - ${today}\n\n### Fixed\n\n- A bug.\n\n## [0.6.0] - 2026-09-27\n`,
  );
});

test("a bump points the [unreleased] compare link at the new tag", () => {
  const root = project();
  const log = path.join(root, "CHANGELOG.md");
  fs.appendFileSync(
    log,
    "\n[unreleased]:\n  https://github.com/o/r/compare/dotclaude--v0.5.1...HEAD\n",
  );
  const res = bump(root, "patch");
  expect(res.status, res.stderr).toBe(0);
  expect(read(root, "CHANGELOG.md")).toEndWith(
    "\n[unreleased]:\n  https://github.com/o/r/compare/dotclaude--v0.6.1...HEAD\n",
  );
});

test("a dry run writes nothing", () => {
  const root = project();
  const before = snapshot(root);
  const res = bump(root, "patch", "--dry-run");
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toContain("0.6.0 -> 0.6.1");
  expect(snapshot(root)).toStrictEqual(before);
});

test("mismatched manifests or an existing section stop the bump before any write", () => {
  const mismatched = project("0.6.0", "0.5.9");
  const before = snapshot(mismatched);
  const res = bump(mismatched, "patch");
  expect(res.status).toBe(1);
  // The error names both versions it found.
  expect(res.stderr).toContain("0.6.0");
  expect(res.stderr).toContain("0.5.9");
  expect(snapshot(mismatched)).toStrictEqual(before);

  const taken = project();
  const untouched = snapshot(taken);
  const again = bump(taken, "0.6.0");
  expect(again.status).toBe(1);
  expect(again.stderr).toContain("0.6.0");
  expect(snapshot(taken)).toStrictEqual(untouched);
});
