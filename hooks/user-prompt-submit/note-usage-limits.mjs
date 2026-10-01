#!/usr/bin/env bun
// UserPromptSubmit: when the user's Claude usage passes 75% or 90% of the
// session or weekly limit (75% is where Claude Code starts warning), tell the
// main agent once per level, with the reset times, so it routes the rest of
// the work to stretch what is left. While the main context is past
// CONTEXT_NOTE_TOKENS, tell it the size on each prompt: no hook input gives
// it, and automatic compaction keeps only a summary that Claude cannot choose.

import fs from "node:fs";
import path from "node:path";
import { USAGE_LEVELS } from "../lib/_budget.mjs";
import { emit, option, run, stateDir, userTyped } from "../lib/_common.mjs";
import { contextNote, readUsage } from "../lib/_usage.mjs";

const LEVELS = [...USAGE_LEVELS].reverse();

function level(pct) {
  return LEVELS.find((l) => pct !== null && pct >= l) ?? 0;
}

const utc = (ms) =>
  `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const limit = (name, pct, resetsAt) =>
  `${name} ${pct ?? "?"}%${resetsAt === null ? "" : ` (resets ${utc(resetsAt)})`}`;

function usageNote(data) {
  const usage = readUsage();
  if (!usage) return null;
  const worst = Math.max(level(usage.session), level(usage.weekly));
  const safe = String(data.session_id || "unknown").replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  );
  const file = path.join(stateDir(), `${safe}.usage-level`);
  let told = 0;
  try {
    told = Number(fs.readFileSync(file, "utf8")) || 0;
  } catch {
    told = 0;
  }
  if (worst <= told) return null;
  fs.writeFileSync(file, String(worst));
  const parts = [
    limit("session", usage.session, usage.sessionResetsAt),
    limit("weekly", usage.weekly, usage.weeklyResetsAt),
  ];
  if (usage.fable !== null) parts.push(`Fable ${usage.fable}% of its cap`);
  const asOf = new Date(usage.fetchedAtMs).toISOString().slice(11, 16);
  const advice =
    worst >= 90
      ? "Little usage is left. Finish the current step. Start no new fan-out. Tell the user before you start any large piece of work. If the remaining work does not fit before the limit, write a handoff note with the `handoff` skill, and tell the user the reset time."
      : "Make the remaining usage last. Prefer the Sonnet 5.5 agents for well-specified work. Keep briefs and fan-out small. Do not switch to Fable. Before the context grows large, write a handoff note with the `handoff` skill, and ask the user to run `/clear`.";
  return `<usage_limits source="dotclaude">Claude usage as of ${asOf} UTC: ${parts.join(", ")}. ${advice}</usage_limits>`;
}

run((data) => {
  if (!option("usage_notes")) return;
  if (!userTyped(data.prompt)) return;
  const notes = [usageNote(data), contextNote(data)].filter(Boolean);
  if (!notes.length) return;
  emit({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: notes.join("\n"),
    },
  });
});
