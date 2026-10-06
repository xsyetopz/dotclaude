// The pointer to the newest open handoff note.

import { clause } from "../terms.mjs";

/** The `key: value` pairs of a note's leading front matter. */
export function frontMatter(text) {
  const out = {};
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  for (const line of head.split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*?)\s*$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

/**
 * The newest note that has the status `in-progress`, or undefined. `notes`
 * holds `{ name, text }`, and a name starts with its UTC time.
 */
export function newestOpen(notes) {
  return [...notes]
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((n) => ({ ...n, meta: frontMatter(n.text) }))
    .find((n) => n.meta.status === "in-progress");
}

/**
 * When an agent may close a note.
 * An agent once set `done` on a note whose Open list still had items, and the items were lost.
 */
export const CLOSE_RULE =
  "Set the `status` of the note to `done` only when each item in its **Open** section is done.\nIf you copy the open items into a newer note, set the status to `superseded`.\nIf an item is still open, keep the status `in-progress`.";

/**
 * What each open item needs.
 * Open items once moved from note to note with no reason and no owner.
 */
export const OPEN_RULE =
  "Give each item in **Open** the reason that it stays open, and its owner (the user, or the next session).\nIf an item was open in an earlier note, do it in this session, or ask the user about it through `AskUserQuestion`, because an item that moves from note to note with no decision never closes.";

/** The SessionStart context that points at `note`. */
export const pointer = ({ name, meta }) =>
  clause(
    "handoff",
    `<handoff>\nAn earlier session left a handoff note at \`.claude/handoffs/${name}\`${meta.written ? ` (written ${meta.written})` : ""}.\nWhen the user asks to continue earlier work, read the note first.\nThen compare it with \`git status\` and \`git log --oneline -5\` before you act, because later commits and edits make parts of it stale.\nWhere they differ, the repository is correct.\n${CLOSE_RULE}\n${OPEN_RULE}\n</handoff>`,
  );
