#!/usr/bin/env bun
// UserPromptSubmit: when a prompt arrives after the main conversation's prompt
// cache expired and the context is large, tell the user. That turn re-reads
// the whole context uncached, and so does a `/compact` run now. A handoff and
// `/clear` start small. The notice goes to the user only, so it adds nothing
// to the context.
//
// The main conversation's cache lives 1 hour on a subscription within its
// limits and 5 minutes otherwise (code.claude.com/docs/en/prompt-caching).
// Without a 5-minute setting this assumes 1 hour, so it can stay silent when
// the cache already expired, but never warns while it is warm.

import { k, STALE_CACHE_CONTEXT_TOKENS } from "../lib/_budget.mjs";
import { emit, option, run, userTyped } from "../lib/_common.mjs";
import { lastMainCall } from "../lib/_transcript.mjs";

const MINUTE = 60_000;

function ttlMs(env = process.env) {
  const five =
    env.CLAUDE_CODE_PROMPT_CACHE_TTL === "5m" ||
    env.FORCE_PROMPT_CACHING_5M === "1";
  return (five ? 5 : 60) * MINUTE;
}

function duration(ms) {
  const minutes = Math.floor(ms / MINUTE);
  return minutes >= 120 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;
}

run((data) => {
  if (!option("usage_notes")) return;
  if (!userTyped(data.prompt) || !data.transcript_path) return;
  const call = lastMainCall(data.transcript_path);
  if (!call || call.context < STALE_CACHE_CONTEXT_TOKENS) return;
  const idle = Date.now() - call.at;
  if (idle < ttlMs()) return;
  emit({
    systemMessage: `The session was idle for ${duration(idle)}, longer than the prompt cache lives, so this turn reads all ${k(call.context)} tokens of context uncached. A \`/compact\` now does the same. For new work, ask for a handoff note, then \`/clear\`. Before the next long break, \`/compact\` or hand off while the cache is warm.`,
  });
});
