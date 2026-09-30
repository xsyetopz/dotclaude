#!/usr/bin/env bun
// Update the catalog of open source AI contribution policies from
// melissawm/open-source-ai-contribution-policies.
//
//   bun scripts/update-ai-policies.mjs [--out FILE] [--ship] [--dry-run]
//
// It writes to the plugin data directory by default, where the Bash guard
// reads it before the shipped snapshot. `--ship` writes the shipped snapshot
// `hooks/lib/_ai-policies.json` (for a dotclaude release).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  blobSha,
  parseReadme,
  RAW_URL,
  UPSTREAM,
} from "../hooks/lib/_ai-policies.mjs";

const SHIPPED = path.join(
  import.meta.dir,
  "..",
  "hooks",
  "lib",
  "_ai-policies.json",
);

function defaultOut() {
  const data =
    process.env.CLAUDE_PLUGIN_DATA ||
    path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
      "plugins",
      "data",
      "dotclaude-dotclaude",
    );
  return path.join(data, "ai-policies.json");
}

export function buildCatalog(markdown, sha, now = new Date()) {
  return {
    source: `https://github.com/${UPSTREAM.repo}/blob/${UPSTREAM.branch}/${UPSTREAM.path}`,
    license: "CC0-1.0",
    sha,
    updated: now.toISOString().slice(0, 10),
    entries: parseReadme(markdown),
  };
}

async function fetchReadme() {
  const res = await fetch(RAW_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok)
    throw new Error(`the server answered ${res.status} for ${RAW_URL}`);
  const markdown = await res.text();
  return { sha: blobSha(markdown), markdown };
}

async function main(argv) {
  const at = argv.indexOf("--out");
  const out = argv.includes("--ship")
    ? SHIPPED
    : at === -1
      ? defaultOut()
      : path.resolve(argv[at + 1] ?? "");
  const { sha, markdown } = await fetchReadme();
  const catalog = buildCatalog(markdown, sha);
  const forbid = catalog.entries.filter((e) => /^no\b/i.test(e.allowed));
  const summary = `${catalog.entries.length} projects, ${forbid.length} forbid AI contributions, README ${sha.slice(0, 12)}`;
  if (argv.includes("--dry-run")) {
    console.log(`Would write ${out}: ${summary}`);
    return;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${out}: ${summary}`);
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((err) => {
    console.error(`update-ai-policies: ${err.message}`);
    process.exitCode = 1;
  });
