#!/usr/bin/env bun

// The child process of a permission notification: it waits, and then sends
// one reminder if the notice is still unanswered (`_reminder.mjs`). It runs
// with no shell, and it never fails loudly, because a reminder is only a hint.

import { spawn } from "node:child_process";
import { NOTIFY_REMINDER_MS } from "./_budget.mjs";
import { nodeIo } from "./_io-node.mjs";
import { remindIfPending } from "./_reminder.mjs";

/** Wait `delayMs`, and then send the reminder if it is due. */
export async function remind(io, notice, delayMs = NOTIFY_REMINDER_MS) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return remindIfPending(io, notice).catch(() => false);
}

/**
 * Start the child and let the caller exit at once. The argument holds only
 * the session and the marker sequence, with no shell. The notice text stays
 * in the marker file, because other local users can read an argument.
 */
export function startReminder(notice, delayMs = NOTIFY_REMINDER_MS) {
  try {
    const child = spawn(
      process.execPath,
      [
        import.meta.filename,
        JSON.stringify({
          notice: { sessionId: notice.sessionId, seq: notice.seq },
          delayMs,
        }),
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.on("error", () => {});
    child.unref();
  } catch {
    // No reminder comes.
  }
}

if (import.meta.main) {
  try {
    const { notice, delayMs } = JSON.parse(process.argv[2]);
    await remind(nodeIo(), notice, delayMs);
  } catch {
    // Fail silently.
  }
}
