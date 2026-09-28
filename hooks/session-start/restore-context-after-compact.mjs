#!/usr/bin/env bun
// SessionStart(compact): restore the user's recent messages verbatim, the
// uncommitted files split into this session's edits and everyone else's, and
// the last check result after compaction.

import { execFileSync } from "node:child_process";
import { emit, option, projectRoot, run } from "../lib/_common.mjs";
import { editedBySession, load } from "../lib/_ledger.mjs";
import { recentPrompts } from "../lib/_transcript.mjs";

const CONTEXT_BUDGET = 2500;

/** Uncommitted paths (tracked changes and untracked files), relative to root. */
function changedPaths(root) {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "status", "--porcelain", "--untracked-files=all"],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).split(" -> ").at(-1).replace(/^"|"$/g, ""));
  } catch {
    return [];
  }
}

const list = (paths) =>
  paths.length > 15
    ? `${paths.slice(0, 15).join(", ")}, and ${paths.length - 15} more`
    : paths.join(", ");

run((data) => {
  if (data.source !== "compact" || !option("compact_carryover")) return;
  const state = load(data.session_id, null);
  const prompts = state.prompts?.length
    ? state.prompts
    : recentPrompts(data.transcript_path ?? "");
  const parts = [];
  if (prompts.length) {
    parts.push(
      `The user's most recent messages before compaction, verbatim, oldest first:\n${prompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
    );
  }
  // Split uncommitted changes by who made them: the transcript before
  // compaction was the only record, and git diff mixes everyone's edits.
  const mine = editedBySession(data.session_id);
  const changed = changedPaths(projectRoot(data));
  const ours = changed.filter((p) => mine.has(p));
  const theirs = changed.filter((p) => !mine.has(p));
  if (ours.length)
    parts.push(
      `Uncommitted files this session or its subagents edited: ${list(ours)}.`,
    );
  if (theirs.length)
    parts.push(
      `Uncommitted files not recorded as edited through this session's tools: ${list(theirs)}. They may be the user's or another session's work, or changes from formatters or codemods this session ran. Do not revert them. Check the transcript or the diff before you say whether they are your changes.`,
    );
  if (state.lastCheck) {
    const c = state.lastCheck;
    const stale =
      state.lastEdit && state.lastEdit.seq > c.seq
        ? ". Files changed after it"
        : "";
    parts.push(
      `Last check run: \`${c.command}\` ${c.ok ? "passed" : `failed${c.code ? ` (exit ${c.code})` : ""}`}${stale}.`,
    );
  }
  if (!parts.length) return;
  let text = `The dotclaude plugin kept this state from before compaction:\n\n${parts.join("\n\n")}`;
  if (text.length > CONTEXT_BUDGET)
    text = `${text.slice(0, CONTEXT_BUDGET)} [...]`;
  emit({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text,
    },
  });
});
