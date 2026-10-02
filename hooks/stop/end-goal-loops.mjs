#!/usr/bin/env bun
// Stop: end a /goal check loop that makes no progress. When the goal's
// condition is unmet, Claude Code's goal check blocks every stop, and a
// model that has been told to stop replies in text and tries again; each
// round re-reads the whole context until Claude Code gives up after 9. Only
// the user can end a goal early (`/goal clear`), so after two goal blocks in
// a row with no tool call in between, this ends the turn and says so.
// `continue: false` from any Stop hook wins over other hooks' blocks.
// Each failed check is written as a `goal_status` attachment with
// `met: false`; the feedback text starts with the user's own condition, so
// it cannot tell a goal block from another hook's. The `sentinel` records
// mark setting or meeting a goal, not a check.

import fs from "node:fs";
import { emit, run } from "../lib/_common.mjs";
import { option } from "../lib/_core.mjs";

const TAIL_BYTES = 400_000;
const LIMIT = 2;

function tail(file) {
  try {
    const fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf
      .toString("utf8")
      .split("\n")
      .slice(start ? 1 : 0);
  } catch {
    return [];
  }
}

/** Goal blocks in a row, newest first, with no tool call since the first. */
export function idleGoalBlocks(lines) {
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let record;
    try {
      record = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const content = record?.message?.content;
    if (
      record?.type === "assistant" &&
      Array.isArray(content) &&
      content.some((b) => b?.type === "tool_use")
    )
      break;
    const attachment = record?.attachment;
    if (
      attachment?.type === "goal_status" &&
      attachment.met === false &&
      !attachment.sentinel
    )
      count += 1;
    if (record?.type !== "user") continue;
    if (
      !record.isMeta &&
      !(
        Array.isArray(content) && content.some((b) => b?.type === "tool_result")
      )
    )
      break; // a prompt the user typed starts a new round
  }
  return count;
}

run((data) => {
  if (!option(process.env, "gate_goal_stall") || !data.stop_hook_active) return;
  const blocks = idleGoalBlocks(tail(data.transcript_path ?? ""));
  if (blocks < LIMIT) return;
  emit({
    continue: false,
    stopReason: `The /goal check blocked this stop ${blocks} times in a row with no work in between. The goal is paused. To change it, run \`/goal <new condition>\`. To end it early, run \`/goal clear\`. To keep working toward it, send a message.`,
  });
});
