#!/usr/bin/env bun
// SessionStart(compact): restore the user's recent messages verbatim, the
// uncommitted files split into this session's edits and everyone else's, and
// the last check result after compaction. The working rules come again from
// their own hook (`add-working-rules.mjs`).

import { execFileSync } from "node:child_process";
import { emit, run } from "../lib/_common.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import { compactionsFile, countOf } from "../lib/_io-mod.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { editedBySession, load } from "../lib/_ledger.mjs";
import { isSubagent, recentPrompts } from "../lib/_transcript.mjs";
import { LAST_PROMPT_CHARS } from "../lib/_transcript-parse.mjs";

const CONTEXT_BUDGET = 2500;
// A cut message keeps its start and its end, because a long message often
// ends with the request. Less room than this drops the message.
const MIN_CUT = 200;
const CUT = " [...] ";
// Each file list has its own bound, so the newest prompt and the
// instructions always fit in CONTEXT_BUDGET. The ledger keeps at most 200
// characters of a check command.
const LIST_CHARS = 400;

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

/** The paths that fit in LIST_CHARS, and a count of the others. */
function list(paths) {
  let out = "";
  let shown = 0;
  for (const p of paths) {
    const next = shown ? `${out}, ${p}` : p;
    if (next.length > LIST_CHARS) break;
    out = next;
    shown += 1;
  }
  const more = paths.length - shown;
  if (!more) return out;
  return shown ? `${out}, and ${more} more` : `${more} files`;
}

/**
 * The quoted lines of `prompts` that fit in `room` characters, oldest first,
 * numbered by their place in `prompts`. The newest message holds the
 * current request, so the fill starts there and the oldest messages drop
 * first. `cut` is true when a message is shortened or left out.
 */
function fitPrompts(prompts, room) {
  const lines = [];
  let left = room;
  let cut = prompts.some((p) => p.endsWith(" [...]"));
  for (let i = prompts.length - 1; i >= 0; i -= 1) {
    const line = `${i + 1}. ${prompts[i]}`;
    const space = left - (lines.length ? 1 : 0);
    if (line.length <= space) {
      lines.unshift(line);
      left = space - line.length;
      continue;
    }
    cut = true;
    if (space >= MIN_CUT) {
      const keep = space - CUT.length;
      const head = Math.ceil(keep / 2);
      lines.unshift(line.slice(0, head) + CUT + line.slice(head - keep));
    }
    break;
  }
  return { quoted: lines.join("\n"), cut };
}

/**
 * Keep the count of compactions for the hooks module, because the engine
 * gives the module no transcript and no compaction boundary. Claude Code can
 * run this hook before it writes the new boundary to the transcript, so the
 * count is the larger of the kept count plus one and the transcript count.
 * A failure keeps the old count, and the carry-over still runs.
 */
async function keepCompactions(io, data) {
  if (!data.session_id) return;
  const file = compactionsFile(io, data.session_id);
  try {
    const kept = countOf(await io.fs.read(file).catch(() => "")) ?? 0;
    const seen = (await io.session.compactions()) ?? 0;
    await io.fs.write(file, String(Math.max(kept + 1, seen)));
  } catch {
    // The module then reads the old count or no count.
  }
}

run(async (data) => {
  if (data.source !== "compact" || isSubagent(data)) return;
  const io = nodeIo(data);
  await keepCompactions(io, data);
  if (!option(process.env, "context_compact_carryover")) return;
  const state = await load(io, data.session_id, null);
  const prompts = state.prompts?.length
    ? state.prompts
    : recentPrompts(data.transcript_path ?? "", 5, LAST_PROMPT_CHARS);
  const parts = [];
  // Split uncommitted changes by who made them: the transcript before
  // compaction was the only record, and git diff mixes everyone's edits.
  const mine = await editedBySession(io, data.session_id);
  const changed = changedPaths(projectRoot(io, data));
  const ours = changed.filter((p) => mine.has(p));
  const theirs = changed.filter((p) => !mine.has(p));
  if (ours.length)
    parts.push(
      `Uncommitted files that this session or its subagents edited: ${list(ours)}.`,
    );
  if (theirs.length)
    parts.push(
      `<other_changes>\n${list(theirs)}\n</other_changes>\nThe tools of this session did not record edits to these uncommitted files.\nIf a formatter or codemod that this session ran did not change a file, the user changed it.\nKeep these changes, and do not say that they are yours.`,
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
  const head = "The dotclaude plugin kept this state from before compaction.";
  // The cut shortens only the quoted prompts, so their closing tag and the
  // instructions after them stay.
  if (prompts.length) {
    const open = "<recent_user_messages>\n";
    let close =
      "\n</recent_user_messages>\nThese are the most recent messages of the user before compaction, verbatim and oldest first.";
    // A cut costs a pointer to the full text, which Claude reads only when
    // it needs the text.
    const pointer = data.transcript_path
      ? `\nA \`[...]\` marks text that this note leaves out, and a missing number is a message that it leaves out.\nThe full messages are in the user entries of the transcript \`${data.transcript_path}\`.`
      : "";
    const room =
      CONTEXT_BUDGET -
      [head, open + close + pointer, ...parts].join("\n\n").length;
    const { quoted, cut } = fitPrompts(prompts, room);
    if (cut) close += pointer;
    if (quoted) parts.unshift(open + quoted + close);
  }
  if (!parts.length) return;
  let text = `${head}\n\n${parts.join("\n\n")}`;
  if (text.length > CONTEXT_BUDGET)
    text = `${text.slice(0, CONTEXT_BUDGET)} [...]`;
  emit({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text,
    },
  });
});
