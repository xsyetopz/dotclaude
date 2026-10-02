#!/usr/bin/env bun
// Stop hook: send Claude back once when an agent-loop slice has the status
// `implemented` but no review. In the loop, a reviewer that sees only the
// diff finds what the implementer rationalized. A slice merged without that
// review loses the check. The same set of unreviewed slices blocks at most
// once, so a loop that the user paused lets the stop through.

import fs from "node:fs";
import path from "node:path";
import { run, stopFeedback } from "../lib/_common.mjs";
import { option, projectRoot, stateDir } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { loopSlices } from "../lib/_loop.mjs";
import { waitsForUser } from "../lib/_transcript.mjs";

run(async (data) => {
  if (
    !option(process.env, "gate_tasks") ||
    data.stop_hook_active ||
    data.agent_id
  )
    return;
  if (
    (data.background_tasks ?? []).some(
      (t) => t.type === "shell" || t.type === "subagent",
    )
  )
    return;
  const io = nodeIo(data);
  const open = (await loopSlices(io, projectRoot(io, data))).filter(
    (s) => s.status === "implemented",
  );
  if (!open.length || waitsForUser(data.transcript_path)) return;
  const file = path.join(
    stateDir(nodeIo()),
    `${String(data.session_id).replace(/[^A-Za-z0-9_-]/g, "_")}.loop-reviews`,
  );
  const key = open.map((s) => String(s.id)).join(",");
  try {
    if (fs.readFileSync(file, "utf8") === key) return;
  } catch {
    // No block yet this session.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key);
  const list = open.map((s) => `- \`${s.id}\``).join("\n");
  stopFeedback(
    data,
    [
      "<unreviewed_slices>",
      list,
      "</unreviewed_slices>",
      "These `.dotclaude/loop/slices.jsonl` slices are `implemented` with no review.",
      "For each slice, do one:",
      "- Give its diff to `reviewer` with the `diff` lens for a fresh view.",
      "  Then set its status to `reviewed`.",
      "- If it failed or you dropped it, set its status to `failed` with a one-line reason.",
      "This check stops you once for these slices.",
    ].join("\n"),
  );
});
