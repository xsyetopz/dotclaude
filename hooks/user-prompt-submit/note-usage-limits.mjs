// UserPromptSubmit: when the user's Claude usage passes 75% or 90% of the
// session or weekly limit (75% is where Claude Code starts warning), tell the
// main agent once per level, with the reset times, so it routes the rest of
// the work to stretch what is left. While the main context is past
// CONTEXT_NOTE_TOKENS, tell it the size on each prompt: no hook input gives
// it, and automatic compaction keeps only a summary that Claude cannot choose.

import { USAGE_LEVELS } from "../lib/_budget.mjs";
import { contextNote } from "../lib/_context-note.mjs";
import { option, stateDir, userTyped } from "../lib/_core.mjs";
import { pathFor } from "../lib/_path.mjs";
import { readUsage } from "../lib/_usage.mjs";

const LEVELS = [...USAGE_LEVELS].reverse();

function level(pct) {
  return LEVELS.find((l) => pct !== null && pct >= l) ?? 0;
}

const utc = (ms) =>
  `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const limit = (name, pct, resetsAt) =>
  `${name} ${pct ?? "?"}%${resetsAt === null ? "" : ` (resets ${utc(resetsAt)})`}`;

async function usageNote(io, data) {
  const usage = await readUsage(io);
  if (!usage) return null;
  const worst = Math.max(level(usage.session), level(usage.weekly));
  const safe = String(data.session_id || "unknown").replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  );
  const file = pathFor(io.platform).join(stateDir(io), `${safe}.usage-level`);
  const told = Number(await io.fs.read(file).catch(() => "")) || 0;
  if (worst <= told) return null;
  await io.fs.write(file, String(worst));
  const parts = [
    limit("session", usage.session, usage.sessionResetsAt),
    limit("weekly", usage.weekly, usage.weeklyResetsAt),
  ];
  if (usage.fable !== null) parts.push(`Fable ${usage.fable}% of its cap`);
  const asOf = new Date(usage.fetchedAtMs).toISOString().slice(11, 16);
  const advice =
    worst >= 90
      ? "Little usage is left.\nWrite a handoff note with the `handoff` skill now, then finish the current step.\nStart no new fan-out.\nTell the user the reset time before you start any large piece of work."
      : "Make the remaining usage last.\nPrefer the Sonnet 5.5 agents for well-specified work.\nKeep briefs and fan-out small.\nDo not switch to Fable.\nBefore the context grows large, write a handoff note with the `handoff` skill, and ask the user to run `/clear`.";
  return `<usage_limits>\nClaude usage as of ${asOf} UTC: ${parts.join(", ")}.\n${advice}\n</usage_limits>`;
}

export default async (io, data) => {
  if (!option(io.env, "usage_notes")) return null;
  if (!userTyped(data.prompt)) return null;
  const notes = [await usageNote(io, data), await contextNote(io, data)].filter(
    Boolean,
  );
  if (!notes.length) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: notes.join("\n"),
    },
  };
};
