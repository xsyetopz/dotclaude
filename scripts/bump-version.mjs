#!/usr/bin/env bun
// Bump the plugin version by semver in .claude-plugin/plugin.json and
// package.json together, and move the CHANGELOG's [Unreleased] entries under
// a new dated heading.
//
//   bun scripts/bump-version.mjs <major|minor|patch|X.Y.Z> [--dry-run] [--root DIR]
//
// Only the "version" line of each manifest and one CHANGELOG line change, so
// formatting and key order stay as they are.

import fs from "node:fs";
import path from "node:path";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const VERSION_LINE = /^(\s*"version":\s*)"([^"]*)"/m;
const UNRELEASED = "## [Unreleased]\n";

export function nextVersion(current, level) {
  if (SEMVER.test(level)) return level;
  const m = SEMVER.exec(current);
  if (!m) throw new Error(`current version "${current}" is not X.Y.Z`);
  const [major, minor, patch] = m.slice(1).map(Number);
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(
        `level must be major, minor, patch, or X.Y.Z, not "${level}"`,
      );
  }
}

/** The files and new contents a bump writes; throws before anything is written. */
export function plan(root, level, today) {
  const manifests = [".claude-plugin/plugin.json", "package.json"].map(
    (rel) => {
      const file = path.join(root, rel);
      const text = fs.readFileSync(file, "utf8");
      const m = VERSION_LINE.exec(text);
      if (!m) throw new Error(`${rel} has no "version" line`);
      return { file, text, version: m[2] };
    },
  );
  const versions = new Set(manifests.map((m) => m.version));
  if (versions.size !== 1)
    throw new Error(
      `plugin.json and package.json disagree (${[...versions].join(" vs ")}); fix them first`,
    );
  const current = manifests[0].version;
  const next = nextVersion(current, level);
  const changelog = path.join(root, "CHANGELOG.md");
  const log = fs.readFileSync(changelog, "utf8");
  if (log.includes(`## [${next}]`))
    throw new Error(`CHANGELOG.md already has a ${next} section`);
  if (!log.includes(UNRELEASED))
    throw new Error("CHANGELOG.md has no ## [Unreleased] heading");
  return {
    current,
    next,
    writes: [
      ...manifests.map(({ file, text }) => ({
        file,
        text: text.replace(VERSION_LINE, `$1"${next}"`),
      })),
      {
        file: changelog,
        text: log.replace(
          UNRELEASED,
          `${UNRELEASED}\n## [${next}] - ${today}\n`,
        ),
      },
    ],
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--root");
  const root = path.resolve(
    at >= 0 ? args[at + 1] : path.join(import.meta.dir, ".."),
  );
  const level = args.find(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--root",
  );
  if (!level) {
    console.error(
      "Usage: bump-version.mjs <major|minor|patch|X.Y.Z> [--dry-run] [--root DIR]",
    );
    process.exit(2);
  }
  let result;
  try {
    result = plan(root, level, new Date().toISOString().slice(0, 10));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`${result.current} -> ${result.next}`);
  for (const { file } of result.writes)
    console.log(`  ${path.relative(root, file)}`);
  if (args.includes("--dry-run")) {
    console.log("Dry run: nothing was written.");
  } else {
    for (const { file, text } of result.writes) fs.writeFileSync(file, text);
  }
}
