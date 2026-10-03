// Whether the last code edit has a check that covers it.
// The stop gate and the task gate share this decision.

import { projectRoot } from "./_core.mjs";
import { lastRunSeq } from "./_ledger.mjs";
import { findTestCommand } from "./_test-command.mjs";

/**
 * The need for a check after the last code edit in `state`, or undefined.
 * `why` is `unchecked` when no check ran after the edit, and `static` when
 * only checks that read the code ran after it, such as a lint run.
 * A `static` check does not exercise the change, so it counts as a check only
 * for a project with no test command.
 * `test` is the result of `findTestCommand`, and the gate needs none without it.
 * `blocked` names the field of `state` that holds the edit that a gate
 * already reported.
 */
export async function pendingCheck(io, data, state, blocked) {
  const { lastEdit, lastCheck } = state;
  if (!lastEdit || state[blocked] === lastEdit.seq) return undefined;
  let why;
  if (!lastCheck || lastCheck.seq < lastEdit.seq) why = "unchecked";
  else if (lastCheck.kind === "static" && lastRunSeq(state) < lastEdit.seq)
    why = "static";
  if (!why) return undefined;
  const test = await findTestCommand(io, projectRoot(io, data));
  return test ? { why, test } : undefined;
}

/** `text` cut to `max` characters, so that a gate message stays short. */
export const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The reason that a `static` check does not test the edit.
 * `subject` is what is not tested, such as `the change in `src/a.js``.
 * The quoted parts are cut to keep the whole gate message short.
 */
export function staticCause(lastCheck, subject) {
  return `The last check (\`${clip(lastCheck.command, 30)}\`) does not run the code, so ${subject}`;
}

/** The action that follows `staticCause`: run the test command of the project. */
export function testAction(test) {
  const command = test.commands?.[0];
  return command
    ? `Run \`${clip(command, 25)}\``
    : "Run the test command of the project";
}

/**
 * The check that failed after the last code edit, or undefined.
 * A failed `run` check stays in `failedRun` when a later `static` check passes.
 */
export function failedCheck(state) {
  const { lastEdit, lastCheck, failedRun } = state;
  if (!lastEdit) return undefined;
  if (lastCheck?.ok === false && lastCheck.seq > lastEdit.seq) return lastCheck;
  return failedRun && failedRun.seq > lastEdit.seq ? failedRun : undefined;
}
