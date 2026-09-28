#!/usr/bin/env bun
// UserPromptSubmit: when the user's Claude usage passes 75% or 90% of the
// session or weekly limit (75% is where Claude Code starts warning), tell the
// main agent once per level, so it routes the rest of the work to stretch
// what is left.

import fs from "node:fs";
import path from "node:path";
import { USAGE_LEVELS } from "../lib/_budget.mjs";
import { emit, option, run, stateDir, userTyped } from "../lib/_common.mjs";
import { readUsage } from "../lib/_usage.mjs";

const LEVELS = [...USAGE_LEVELS].reverse();

function level(pct) {
  return LEVELS.find((l) => pct !== null && pct >= l) ?? 0;
}

run((data) => {
  if (!option("usage_notes")) return;
  if (!userTyped(data.prompt)) return;
  const usage = readUsage();
  if (!usage) return;
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
  if (worst <= told) return;
  fs.writeFileSync(file, String(worst));
  const parts = [
    `session ${usage.session ?? "?"}%`,
    `weekly ${usage.weekly ?? "?"}%`,
  ];
  if (usage.fable !== null) parts.push(`Fable ${usage.fable}% of its cap`);
  const asOf = new Date(usage.fetchedAtMs).toISOString().slice(11, 16);
  const advice =
    worst >= 90
      ? "Little usage is left. Finish the current step. Start no new fan-out. Tell the user before you start any large piece of work."
      : "Make the remaining usage last. Prefer the Sonnet 5 agents for well-specified work. Keep briefs and fan-out small. Do not switch to Fable. Write a handoff before the context grows large.";
  emit({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `<usage_limits source="dotclaude">Claude usage as of ${asOf} UTC: ${parts.join(", ")}. ${advice}</usage_limits>`,
    },
  });
});
