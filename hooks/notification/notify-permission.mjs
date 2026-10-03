#!/usr/bin/env bun

// Notification (permission_prompt): show a desktop notification when Claude
// Code asks for a permission, with the same text and sender as the hooks
// module uses at the end of a turn (`hooks/lib/_notify.mjs`).
// The module already notifies for `AskUserQuestion`, and it flags the open
// question, so a prompt for that tool gets no second notification here.
// After the notification, a detached child sends one reminder when the
// session has not moved on (`hooks/lib/_reminder.mjs`). A newer notice
// replaces the marker, so the older child sends nothing.

import { option } from "../lib/_core.mjs";
import { baseName, notifyText, sendNotice } from "../lib/_notify.mjs";
import { startReminder } from "../lib/_remind-child.mjs";
import {
  clearNotice,
  markNotice,
  questionOpen,
  stillMarked,
} from "../lib/_reminder.mjs";

const TITLE = "Claude Code needs a permission";

/** `start(notice)` starts the reminder, and tests give a fake of it. */
export async function notifyPermission(io, data, start = startReminder) {
  if (!option(io.env, "notify_desktop")) return;
  if (data.notification_type !== "permission_prompt") return;
  if (await questionOpen(io, data.session_id)) return;
  const [task] = await io.session.recentPrompts(1, 200).catch(() => []);
  const text = notifyText(task, data.session_id, baseName(data.cwd));
  // The marker comes first, so a tool result during the send clears it.
  const sessionId = data.session_id;
  const seq = await markNotice(io, sessionId, { title: TITLE, text }).catch(
    () => "",
  );
  const sent = await sendNotice((argv) => io.run(argv, {}), TITLE, text);
  if (!seq || !(await stillMarked(io, sessionId, seq))) return;
  if (sent) start({ sessionId, seq });
  else await clearNotice(io, sessionId).catch(() => {});
}

export default (io, data) => notifyPermission(io, data);
