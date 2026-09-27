#!/usr/bin/env bun
// StopFailure (rate_limit): when a turn stops on a usage limit, show a
// terminal notification with the limit that was hit, when it resets (from
// Claude Code's cached usage), and the command that resumes this session.
// Claude Code ignores every other StopFailure output, and writes
// `terminalSequence` only in an interactive session.

import { emit, option, run } from "../lib/_common.mjs";
import { readUsage } from "../lib/_usage.mjs";

const ESC = "\u001b";
const BEL = "\u0007";

/** Which limit was hit and when it resets, from the cached usage. */
function limitHit(usage) {
  if (!usage) return null;
  const weekly = (usage.weekly ?? 0) > (usage.session ?? 0);
  const at = weekly ? usage.weeklyResetsAt : usage.sessionResetsAt;
  const name = weekly ? "weekly" : "session";
  if (at === null) return { name, when: null };
  const opts = weekly
    ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" };
  return { name, when: new Date(at).toLocaleString(undefined, opts) };
}

/** The notification escape sequence the terminal understands. */
function notification(title, body, env = process.env) {
  const term = `${env.TERM_PROGRAM ?? ""} ${env.TERM ?? ""}`;
  if (/kitty/i.test(term)) return `${ESC}]99;;${title}: ${body}${ESC}\\`;
  if (/iTerm|WezTerm/i.test(term) || env.WT_SESSION)
    return `${ESC}]9;${title}: ${body}${BEL}`;
  return `${ESC}]777;notify;${title};${body}${BEL}`;
}

run((data) => {
  if (!option("usage_notes")) return;
  if (data.error !== "rate_limit") return;
  const hit = limitHit(readUsage());
  const what = hit ? `${hit.name} usage limit` : "Usage limit";
  const when = hit?.when ? `, resets ${hit.when}` : "";
  const resume = data.session_id
    ? `. Resume: claude --resume ${data.session_id}`
    : "";
  // Control characters would end or break the escape sequence.
  const body = [...`${what} reached${when}${resume}`]
    .map((c) => (c < " " || c === "\u007f" || c === ";" ? " " : c))
    .join("");
  emit({ terminalSequence: notification("Claude Code", body) });
});
