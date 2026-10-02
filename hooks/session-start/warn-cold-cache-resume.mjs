#!/usr/bin/env bun
// SessionStart(resume|fork): when the prompt cache has expired and the
// context is large, tell the user what the first prompt costs. That prompt
// writes the whole context to the cache again, at 1.25x or 2x the input price
// instead of reads at 0.05x on Opus 5.5. Claude Code 2.1.287 gives the
// fields. The status line shows the same cold cache only after the first
// prompt.

import { STALE_CACHE_CONTEXT_TOKENS } from "../lib/_budget.mjs";
import { emit, run } from "../lib/_common.mjs";

function idle(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} minutes`;
  return `${Math.round(minutes / 60)} hours`;
}

run((data) => {
  if (!["resume", "fork"].includes(data.source)) return;
  if (data.prompt_cache_likely_expired !== true) return;
  const tokens = Number(data.context_tokens);
  if (!(tokens >= STALE_CACHE_CONTEXT_TOKENS)) return;
  const usd = Number(data.estimated_cache_write_usd);
  const cost =
    Number.isFinite(usd) && usd > 0 ? ` (about $${usd.toFixed(2)})` : "";
  const after = Number.isFinite(data.seconds_since_last_response)
    ? ` after ${idle(data.seconds_since_last_response)}`
    : "";
  emit({
    systemMessage: `The prompt cache of this session expired${after}. The next prompt writes all ${Math.round(tokens / 1000)}k tokens of context to the cache again${cost}. To start from a small context, run \`/clear\` and continue from a handoff note.`,
  });
});
