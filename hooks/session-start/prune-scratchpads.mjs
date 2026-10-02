#!/usr/bin/env bun
// SessionStart (off by default): delete Claude Code session scratchpads and
// loose temp entries nobody has touched in `usage_scratchpad_prune_days` days.
// Claude Code keeps them under $CLAUDE_CODE_TMPDIR (else /tmp) in
// claude-<uid>/, one folder per project and session, and never deletes them;
// builds left there can reach gigabytes. The current session is never pruned.
// The deletion runs in a detached process so the session starts at once.
//
// Manual use, with a dry run unless --apply is given:
//   bun prune-scratchpads.mjs --days 1 [--apply]

import { spawn } from "node:child_process";
import fs from "node:fs";
import { run } from "../lib/_common.mjs";
import { staleEntries, tempRoot } from "../lib/_scratchpads.mjs";

function cli(args) {
  const at = args.indexOf("--days");
  const days = Number(at >= 0 ? args[at + 1] : Number.NaN);
  if (!(days > 0)) {
    console.error("Usage: bun prune-scratchpads.mjs --days <n> [--apply]");
    process.exit(2);
  }
  const root = tempRoot();
  const keep = new Set(
    process.env.CLAUDE_CODE_SESSION_ID
      ? [process.env.CLAUDE_CODE_SESSION_ID]
      : [],
  );
  const stale = staleEntries(root, days, keep);
  for (const entry of stale) console.log(entry);
  console.log(`${stale.length} entries under ${root} idle for ${days}+ days.`);
  if (!args.includes("--apply")) {
    console.log(
      "Dry run: this run deleted nothing. To delete these entries, run again with `--apply`.",
    );
    return;
  }
  for (const entry of stale) fs.rmSync(entry, { recursive: true, force: true });
  console.log("Deleted.");
}

if (process.argv.includes("--days")) cli(process.argv.slice(2));
else
  run((data) => {
    const days = Number(
      process.env.CLAUDE_PLUGIN_OPTION_USAGE_SCRATCHPAD_PRUNE_DAYS,
    );
    if (!(days > 0) || data.source !== "startup") return;
    const stale = staleEntries(
      tempRoot(),
      days,
      new Set([String(data.session_id ?? "")]),
    );
    if (!stale.length) return;
    spawn("rm", ["-rf", "--", ...stale], {
      detached: true,
      stdio: "ignore",
    }).unref();
  });
