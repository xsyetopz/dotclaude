#!/usr/bin/env bun
// SessionStart(startup|clear): when `.claude/handoffs/` holds a note from
// `write-session-handoff` whose status is not `done` or `superseded`, tell
// Claude where the newest one is and to check it against the repository
// before it acts.
// The note stays unread until the user's request needs it, because a note
// for finished or unrelated work costs context and can mislead.

import fs from "node:fs";
import path from "node:path";
import { emit, option, projectRoot, run } from "../lib/_common.mjs";

const DIR = ".claude/handoffs";
// Statuses of a note that no session continues from.
const CLOSED = new Set(["done", "superseded"]);

/** The `key: value` pairs of the note's leading front matter. */
function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  for (const line of m?.[1].split(/\r?\n/) ?? []) {
    const kv = /^(\w+):\s*([^#]*?)\s*(#.*)?$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

/** The open notes, newest first. Note names start with their UTC time. */
function openNotes(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".md"));
  } catch {
    return [];
  }
  const notes = [];
  for (const name of names.sort().reverse()) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    const meta = frontMatter(text);
    if (!CLOSED.has(meta.status)) notes.push({ name, meta });
  }
  return notes;
}

run((data) => {
  // A resumed or compacted session already has the context the note holds.
  if (!["startup", "clear"].includes(data.source)) return;
  if (!option("handoff_pointer")) return;
  const notes = openNotes(path.join(projectRoot(data), DIR));
  if (!notes.length) return;
  const [{ name, meta }, ...older] = notes;
  const facts = [
    meta.status && `status \`${meta.status}\``,
    meta.written && `written ${meta.written}`,
    meta.branch && `on branch \`${meta.branch}\``,
    meta.head && `at \`${meta.head}\``,
  ].filter(Boolean);
  const others = older.length
    ? ` ${older.length} older open ${older.length === 1 ? "note is" : "notes are"} also in \`${DIR}/\`.`
    : "";
  emit({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `<handoff source="dotclaude">An earlier session left a handoff note at \`${DIR}/${name}\`${facts.length ? ` (${facts.join(", ")})` : ""}.${others} When the user asks to continue earlier work, read the note first. Then compare it with \`git status\` and \`git log --oneline -5\` before you act, because commits and edits after the note make parts of it stale. Where they differ, the repository is correct. When the work in the note is complete, set its \`status\` to \`done\`.</handoff>`,
    },
  });
});
