#!/usr/bin/env bun
// Stop: end a /goal check loop that makes no progress. When the goal's
// condition is unmet, Claude Code's goal check blocks every stop, and a
// model that has been told to stop replies in text and tries again; each
// round re-reads the whole context until Claude Code gives up after 9. Only
// the user can end a goal early (`/goal clear`), so after two goal blocks in
// a row with no tool call in between, this ends the turn and says so.
// `continue: false` from any Stop hook wins over other hooks' blocks.

import fs from "node:fs";
import { emit, option, run } from "../lib/_common.mjs";

const GOAL_FEEDBACK = /^\s*Stop hook feedback:\s*\[Goal:/;
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

function text(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (typeof b?.text === "string" ? b.text : ""))
    .join("");
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
    if (record?.type !== "user") continue;
    if (GOAL_FEEDBACK.test(text(content))) count += 1;
    else if (
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
  if (!option("goal_loop_guard") || !data.stop_hook_active) return;
  const blocks = idleGoalBlocks(tail(data.transcript_path ?? ""));
  if (blocks < LIMIT) return;
  emit({
    continue: false,
    stopReason: `The /goal check blocked this stop ${blocks} times in a row with no work in between. The goal is paused. To change it, run \`/goal <new condition>\`; to end it early, \`/goal clear\`; to keep working toward it, send a message.`,
  });
});
