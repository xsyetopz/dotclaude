// The pure parts of the compaction handoff and of the desktop notifications.
// `register.mjs` runs the calls that need `$`.

/**
 * The prompt for the fork before a compaction or a clear. The fork sees the
 * whole conversation, so the note can quote the user.
 */
export const HANDOFF_PROMPT = `<handoff_request>
Write a handoff note for a fresh session that continues this task.
The conversation is about to be compacted or cleared, and the next part starts from this note.
Write only what you verified or what the user said.
Mark each item that you are not sure of as unverified.
Use these sections in this order:

## Goal
Quote each request and constraint of the user exactly, and end with a **Done when** line.

## State
List what is done, with file paths, and if each part is verified.
Mark partial work as partial.

## Decisions
List each choice and its reason, and each option that you rejected.

## Open
List the remaining steps in order, and each question that waits for the user.

## Details
List exact errors, commands, IDs, and \`file:line\` locations.

Do not call tools.
Reply with the note only, with no front matter.
</handoff_request>`;

/** The folder of handoff notes, under the project root. */
export const HANDOFF_DIR = ".claude/handoffs";

const pad = (n) => String(n).padStart(2, "0");

/** `YYYY-MM-DD-HHMM` in UTC for the `Date` `at`. */
export const stamp = (at) =>
  `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;

/** The path of the note of `kind` (`compaction` or `clear`) for `at` under `root`. */
export const handoffPath = (root, at, kind) =>
  `${root.replace(/[\\/]+$/, "")}/${HANDOFF_DIR}/${stamp(at)}-${kind}.md`;

/** The note file: the front matter of the `handoff` skill, then the text. */
export const handoffFile = (text, { branch, head, at }) =>
  `---\nstatus: in-progress\nbranch: ${branch || "unknown"}\nhead: ${head || "unknown"}\nwritten: ${at.toISOString()}\n---\n\n${text.trim()}\n`;

/** The user row that carries the note into the compacted conversation. */
export const handoffRow = (text, path) => ({
  role: "user",
  text: `<compaction_handoff_note path="${path}">\n${text.trim()}\n</compaction_handoff_note>`,
  toolUses: [],
});

/** The basename of a path, for either separator. */
export const baseName = (path) =>
  String(path ?? "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() ?? "";

/**
 * The notification text: the task, the short session id, and the repository,
 * in this order. The task is the first line of the last typed prompt.
 */
export function notifyText(task, sessionId, repo) {
  const line = String(task ?? "")
    .split("\n")
    .find((l) => l.trim());
  const cut = [...(line?.trim() ?? "")].slice(0, 80).join("");
  return [cut || "session", String(sessionId ?? "").slice(0, 8), repo]
    .filter(Boolean)
    .join(" | ");
}

/**
 * The argv that shows a notification. `terminal-notifier` is used when
 * `hasTerminalNotifier` is true, and `osascript` otherwise. The AppleScript
 * text goes in as a quoted string, so quotes and backslashes are escaped.
 */
export function notifyArgv(title, text, hasTerminalNotifier) {
  if (hasTerminalNotifier)
    return ["terminal-notifier", "-title", title, "-message", text];
  const quote = (s) => `"${s.replace(/[\\"]/g, "\\$&")}"`;
  return [
    "osascript",
    "-e",
    `display notification ${quote(text)} with title ${quote(title)}`,
  ];
}

/**
 * Show a notification with the first sender that works: `terminal-notifier`,
 * and then `osascript`. `run(argv)` gives `{ exitCode }` or throws, as a
 * missing program does. It gives true when a sender showed the notification.
 * It never throws, so a system with no sender (Linux) shows nothing and fails
 * silently.
 */
export async function sendNotice(run, title, text) {
  for (const present of [true, false]) {
    try {
      const out = await run(notifyArgv(title, text, present));
      if (out?.exitCode === 0) return true;
    } catch {
      // This sender is missing, so try the next.
    }
  }
  return false;
}
