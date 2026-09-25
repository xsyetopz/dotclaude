#!/usr/bin/env bun
// SessionStart(compact): restore the user's recent messages verbatim, the
// uncommitted-change summary, and the last check result after compaction.

import { execFileSync } from "node:child_process";
import { emit, option, projectRoot, run } from "../lib/_common.mjs";
import { load } from "../lib/_ledger.mjs";
import { recentPrompts } from "../lib/_transcript.mjs";

const CONTEXT_BUDGET = 2500;

function gitStat(root) {
  try {
    const out = execFileSync("git", ["-C", root, "diff", "--stat", "HEAD"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = out.trim().split("\n").filter(Boolean);
    return lines.length > 12
      ? [
          ...lines.slice(0, 10),
          `... ${lines.length - 11} more files`,
          lines.at(-1),
        ].join("\n")
      : lines.join("\n");
  } catch {
    return "";
  }
}

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
  const stat = gitStat(projectRoot(data));
  if (stat) parts.push(`Uncommitted changes (git diff --stat HEAD):\n${stat}`);
  if (state.lastCheck) {
    const c = state.lastCheck;
    const stale =
      state.lastEdit && state.lastEdit.seq > c.seq
        ? "; files were edited after it"
        : "";
    parts.push(
      `Last check run: \`${c.command}\` ${c.ok ? "passed" : `failed${c.code ? ` (exit ${c.code})` : ""}`}${stale}.`,
    );
  }
  if (!parts.length) return;
  let text = `State carried over by the dotclaude plugin:\n\n${parts.join("\n\n")}`;
  if (text.length > CONTEXT_BUDGET)
    text = `${text.slice(0, CONTEXT_BUDGET)} [...]`;
  emit({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text,
    },
  });
});
