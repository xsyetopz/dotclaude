// A resumed or forked session with a large context and an expired prompt
// cache tells the user what the first prompt costs, and nothing otherwise.

import { expect, test } from "bun:test";
import { STALE_CACHE_CONTEXT_TOKENS } from "../../hooks/lib/_budget.mjs";
import { hook } from "../support/hooks.mjs";

function start(fields) {
  const out = hook("session-start/warn-cold-cache-resume.mjs", {
    hook_event_name: "SessionStart",
    source: "resume",
    seconds_since_last_response: 7200,
    context_tokens: STALE_CACHE_CONTEXT_TOKENS + 80_000,
    prompt_cache_likely_expired: true,
    estimated_cache_write_usd: 1.234,
    ...fields,
  });
  return out?.systemMessage;
}

test("a cold resume of a large context names the size, the cost, and /clear", () => {
  const msg = start({});
  expect(msg).toContain("180k tokens");
  expect(msg).toContain("$1.23");
  expect(msg).toContain("2 hours");
  expect(msg).toContain("`/clear`");
  expect(start({ source: "fork" })).toContain("180k tokens");
});

test("the cost is left out when Claude Code gives no estimate", () => {
  const msg = start({ estimated_cache_write_usd: undefined });
  expect(msg).toContain("180k tokens");
  expect(msg).not.toContain("$");
});

test("a warm cache, a small context, or a new session gives no notice", () => {
  expect(start({ prompt_cache_likely_expired: false })).toBeUndefined();
  expect(
    start({ context_tokens: STALE_CACHE_CONTEXT_TOKENS - 1 }),
  ).toBeUndefined();
  expect(start({ context_tokens: undefined })).toBeUndefined();
  expect(start({ source: "startup" })).toBeUndefined();
  expect(start({ source: "compact" })).toBeUndefined();
});
