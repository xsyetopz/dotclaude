// Stop: blocks the end of a turn whose last message asks the user a question in plain text.
// A question in `AskUserQuestion` has options that the user picks with one key,
// and other hooks, such as the dotclaude-jev hook, can add facts to it.

import { TERMS } from "../../lib/terms.mjs";

const CLAUSE = TERMS.findIndex((t) => t.id === "user-questions") + 1;

export const REASON = `Your last message asks the user a question in plain text. Ask each question through \`AskUserQuestion\`, with options. The user can then pick an answer, and other hooks can add facts to the question. If the message has no question to the user, finish your turn again. This is clause ${CLAUSE} of the dotclaude Terms of Use.`;

/** The lines of `text` without code blocks, inline code, headings, and quotes. */
const proseLines = (text) =>
  text
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/`[^`\n]*`/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(#|>)/.test(line));

/** True when one of the last 3 prose lines of `text` ends in a question mark. */
export const asksInPlainText = (text) =>
  proseLines(String(text ?? ""))
    .slice(-3)
    .some((line) => /\?[*_)"']*$/.test(line));

/** The Stop hook output for the input `data`, or undefined to let the turn end. */
export const decisionFor = (data) =>
  !data?.stop_hook_active && asksInPlainText(data?.last_assistant_message)
    ? { decision: "block", reason: REASON }
    : undefined;

if (import.meta.main) {
  let data = {};
  try {
    data = JSON.parse(await Bun.stdin.text());
  } catch {}
  const out = decisionFor(data);
  if (out) process.stdout.write(JSON.stringify(out));
}
