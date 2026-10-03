#!/usr/bin/env bun
// SessionStart(startup|clear): when `.claude/handoffs/` holds a note from
// the `handoff` skill whose status is not `done` or `superseded`, tell
// Claude where the newest one is and to check it against the repository
// before it acts.
// The note stays unread until the user's request needs it, because a note
// for finished or unrelated work costs context and can mislead.
// After the automatic clear of the hooks module, the note goes into the
// context in full, because the prompt that the module sends again continues
// its work, and that prompt can carry no context of its own.

import fs from "node:fs";
import path from "node:path";
import { AUTO_CLEAR_NOTE_MAX_AGE_MS } from "../lib/_budget.mjs";
import { emit, run } from "../lib/_common.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";

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
    if (!CLOSED.has(meta.status)) notes.push({ name, meta, text });
  }
  return notes;
}

/** Whether `note` is the note of the automatic clear that just ran. */
function autoCleared({ name, meta }, now) {
  const age = now - Date.parse(meta.written);
  return (
    name.endsWith("-clear.md") && age >= 0 && age <= AUTO_CLEAR_NOTE_MAX_AGE_MS
  );
}

const context = (additionalContext) =>
  emit({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  });

run((data) => {
  // A resumed or compacted session already has the context the note holds.
  if (!["startup", "clear"].includes(data.source)) return;
  const notes = openNotes(path.join(projectRoot(nodeIo(data), data), DIR));
  if (!notes.length) return;
  const [{ name, meta, text }, ...older] = notes;
  if (
    data.source === "clear" &&
    option(process.env, "context_auto_clear") &&
    autoCleared(notes[0], Date.now())
  ) {
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
    context(
      `<handoff>\ndotclaude saved the handoff note \`${DIR}/${name}\` and cleared the context before the next prompt.\nThe next prompt continues the work in the note, so use the note below as the state of the work.\nWhen the work in the note is complete, set its \`status\` to \`done\`.\n<note>\n${body}\n</note>\n</handoff>`,
    );
    return;
  }
  if (!option(process.env, "context_handoff_pointer")) return;
  const facts = [
    meta.status && `status \`${meta.status}\``,
    meta.written && `written ${meta.written}`,
    meta.branch && `on branch \`${meta.branch}\``,
    meta.head && `at \`${meta.head}\``,
  ].filter(Boolean);
  const others = older.length
    ? `\n${older.length} older open ${older.length === 1 ? "note is" : "notes are"} also in \`${DIR}/\`.`
    : "";
  context(
    `<handoff>\nAn earlier session left a handoff note at \`${DIR}/${name}\`${facts.length ? ` (${facts.join(", ")})` : ""}.${others}\nWhen the user asks to continue earlier work, read the note first.\nThen compare it with \`git status\` and \`git log --oneline -5\` before you act, because commits and edits after the note make parts of it stale.\nWhere they differ, the repository is correct.\nWhen the work in the note is complete, set its \`status\` to \`done\`.\n</handoff>`,
  );
});
