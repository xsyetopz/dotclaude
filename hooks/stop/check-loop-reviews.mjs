#!/usr/bin/env bun
// Stop hook: send Claude back once when an agent-loop slice has the status
// `implemented` but no review. In the loop, a reviewer that sees only the
// diff finds what the implementer rationalized. A slice merged without that
// review loses the check. The same set of unreviewed slices blocks at most
// once, so a loop that the user paused lets the stop through.

import fs from "node:fs";
import path from "node:path";
import {
  option,
  projectRoot,
  run,
  stateDir,
  stopFeedback,
} from "../lib/_common.mjs";
import { loopSlices } from "../lib/_loop.mjs";
import { waitsForUser } from "../lib/_transcript.mjs";

run((data) => {
  if (!option("task_check") || data.stop_hook_active || data.agent_id) return;
  if (
    (data.background_tasks ?? []).some(
      (t) => t.type === "shell" || t.type === "subagent",
    )
  )
    return;
  const open = loopSlices(projectRoot(data)).filter(
    (s) => s.status === "implemented",
  );
  if (!open.length || waitsForUser(data.transcript_path)) return;
  const file = path.join(
    stateDir(),
    `${String(data.session_id).replace(/[^A-Za-z0-9_-]/g, "_")}.loop-reviews`,
  );
  const key = open.map((s) => String(s.id)).join(",");
  try {
    if (fs.readFileSync(file, "utf8") === key) return;
  } catch {
    // No block yet this session.
  }
  fs.writeFileSync(file, key);
  const list = open.map((s) => `- \`${s.id}\``).join("\n");
  stopFeedback(
    data,
    [
      "These agent-loop slices in `.dotclaude/loop/slices.jsonl` have the status `implemented`, but no review:",
      list,
      "For each slice, do one of these:",
      "- Give its diff to `diff-reviewer`, then set its status to `reviewed`.",
      "- The slice failed or you dropped it: set its status to `failed`, and give the reason in one line.",
      "This check does not stop you again for the same slices.",
    ].join("\n"),
  );
});
