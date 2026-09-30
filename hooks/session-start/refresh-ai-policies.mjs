#!/usr/bin/env bun
// SessionStart: when the stored upstream hash of the AI policy list is older
// than a day, fetch it again in a detached process. The contribution guard
// reads only the stored hash, so a slow network never holds a Bash call or
// the session start.
//
// `--refresh` runs the fetch itself. The hook starts this file with it.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { refreshUpstream, upstreamStale } from "../lib/_ai-policies.mjs";
import { option, run } from "../lib/_common.mjs";

if (process.argv.includes("--refresh")) refreshUpstream();
else
  run(() => {
    if (!option("bash_guard") || !upstreamStale()) return;
    spawn(process.execPath, [fileURLToPath(import.meta.url), "--refresh"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  });
