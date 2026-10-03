// The reminder of a permission notification. The `Notification` hook ends
// right after it sends, so a child process waits for the bound (see
// `_remind-child.mjs`). A marker file in the state folder tells the child if
// the notice is still the newest and unanswered. The marker also holds the
// notice text, so the text is not in the argv of the child, where other
// local users can read it. Everything here works over
// `io`, so the hooks module can clear the marker too.

import { stateDir } from "./_core.mjs";
import { sendNotice } from "./_notify.mjs";
import { pathFor } from "./_path.mjs";

/** The marker file of the permission notice of one session. */
export function noticeFile(io, sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  return pathFor(io.platform).join(stateDir(io), `${safe}.permission-notice`);
}

/**
 * The flag file of an open `AskUserQuestion` call of one session. The
 * `Notification` payload names no tool, so the hook reads this flag to leave
 * out the question, for which the module already sent a notification.
 */
function questionFile(io, sessionId) {
  return noticeFile(io, sessionId).replace(/permission-notice$/, "question");
}

/** Set (`open`) or clear the flag of an open question. */
export async function markQuestion(io, sessionId, open) {
  const file = questionFile(io, sessionId);
  if (open) await io.fs.write(file, "open");
  else if (await io.fs.exists(file)) await io.fs.remove(file);
}

/**
 * Whether a question is open. The content counts, because the hooks-module
 * `remove` writes an empty file.
 */
export async function questionOpen(io, sessionId) {
  try {
    return (await io.fs.read(questionFile(io, sessionId))) === "open";
  } catch {
    return false;
  }
}

/**
 * Write a new marker with the `title` and `text` of the notice, which
 * replaces an older one. Gives its sequence.
 */
export async function markNotice(io, sessionId, { title, text }) {
  const seq = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await io.fs.write(
    noticeFile(io, sessionId),
    JSON.stringify({ seq, title, text }),
  );
  return seq;
}

/** The marker of a session, or null when it is missing or not valid. */
async function readNotice(io, sessionId) {
  try {
    const marker = JSON.parse(await io.fs.read(noticeFile(io, sessionId)));
    return marker && typeof marker === "object" ? marker : null;
  } catch {
    return null;
  }
}

/** Whether marker `seq` is still the current marker of the session. */
export async function stillMarked(io, sessionId, seq) {
  return (await readNotice(io, sessionId))?.seq === seq;
}

/**
 * The user answered or the session moved on, so no reminder is due. It
 * deletes nothing when no marker exists, because the hooks-module `remove`
 * writes an empty file.
 */
export async function clearNotice(io, sessionId) {
  const file = noticeFile(io, sessionId);
  if (await io.fs.exists(file)) await io.fs.remove(file);
}

/**
 * Send the one reminder when marker `seq` is still the current marker,
 * with the title and text that the marker holds. The
 * marker is cleared first, so a second child cannot send a second reminder.
 * It gives true when it sent.
 */
export async function remindIfPending(io, { sessionId, seq }) {
  const marker = await readNotice(io, sessionId);
  if (!seq || marker?.seq !== seq) return false;
  await clearNotice(io, sessionId);
  return sendNotice(
    (argv) => io.run(argv, {}),
    `Reminder: ${marker.title}`,
    marker.text,
  );
}
