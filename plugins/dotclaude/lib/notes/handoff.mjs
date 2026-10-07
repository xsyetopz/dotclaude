// The pointer to the newest open handoff note.

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
 * The SessionStart pointer to the open handoff `note`.
 * The `handoff` skill gives the rules to read, write, and close a note.
 */
export function handoffPointer({ name, meta }) {
  const written = meta.written ? ` (written ${meta.written})` : "";
  return `An earlier session left a handoff note at \`.claude/handoffs/${name}\`${written}.\nWhen the user asks to continue earlier work, load the \`dotclaude:handoff\` skill and read the note first.`;
}
