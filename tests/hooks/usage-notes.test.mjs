// Usage-limit notes from Claude Code's cached usage.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { CONTEXT_NOTE_TOKENS, k } from "../../hooks/lib/_budget.mjs";
import { mainContextTokens, readUsage } from "../../hooks/lib/_usage.mjs";
import { isolatedHook as hook, tmp } from "../support/hooks.mjs";

/** A config dir whose cached usage was fetched `ageMs` ago. */
function usageDir(
  ageMs,
  { session, weekly, fable = 0, sessionReset, weeklyReset },
) {
  const dir = tmp("dotclaude-usage-");
  fs.writeFileSync(
    path.join(dir, ".claude.json"),
    JSON.stringify({
      cachedUsageUtilization: {
        fetchedAtMs: Date.now() - ageMs,
        utilization: {
          five_hour: { utilization: session },
          seven_day: { utilization: weekly },
          limits: [
            { kind: "session", percent: session, resets_at: sessionReset },
            { kind: "weekly_all", percent: weekly, resets_at: weeklyReset },
            {
              kind: "weekly_scoped",
              percent: fable,
              scope: { model: { display_name: "Fable" } },
            },
          ],
        },
      },
    }),
  );
  return dir;
}

test("readUsage reads Claude Code's cached usage and ignores a stale copy", () => {
  const fresh = readUsage({
    CLAUDE_CONFIG_DIR: usageDir(60_000, { session: 28, weekly: 87, fable: 3 }),
  });
  expect({
    session: fresh.session,
    weekly: fresh.weekly,
    fable: fresh.fable,
  }).toStrictEqual({ session: 28, weekly: 87, fable: 3 });
  expect(
    readUsage({
      CLAUDE_CONFIG_DIR: usageDir(2 * 3600_000, { session: 99, weekly: 99 }),
    }),
  ).toBe(null);
});

test("usage notes fire once per level: 75%, then 90%", () => {
  const data = tmp("dotclaude-data-");
  const prompt = (dir) =>
    hook(
      "user-prompt-submit/note-usage-limits.mjs",
      { session_id: "s3", prompt: "next step" },
      { CLAUDE_PLUGIN_DATA: data, CLAUDE_CONFIG_DIR: dir },
    );
  expect(prompt(usageDir(60_000, { session: 20, weekly: 50 }))).toBe(null);
  const at87 = prompt(usageDir(60_000, { session: 28, weekly: 87 }))
    .hookSpecificOutput.additionalContext;
  expect(at87).toMatch(/^\[dotclaude\] <usage_limits/);
  expect(at87).toMatch(/session 28%/);
  expect(at87).toMatch(/weekly 87%/);
  expect(at87).toContain("Sonnet 5.5");
  expect(prompt(usageDir(60_000, { session: 30, weekly: 88 }))).toBe(null);
  const at91 = prompt(usageDir(60_000, { session: 91, weekly: 88 }))
    .hookSpecificOutput.additionalContext;
  expect(at91).toMatch(/session 91%/);
  // With the numbers taken out, the 90% note still differs from the 75% one.
  const advice = (text) => text.replace(/\d+/g, "#");
  expect(advice(at91)).not.toBe(advice(at87));
});

test("the usage note gives each limit's reset time", () => {
  const note = hook(
    "user-prompt-submit/note-usage-limits.mjs",
    { session_id: "s4", prompt: "next step" },
    {
      CLAUDE_CONFIG_DIR: usageDir(60_000, {
        session: 92,
        weekly: 40,
        sessionReset: "2026-09-27T08:09:59.549386+00:00",
        weeklyReset: "2026-10-02T17:00:00Z",
      }),
    },
  ).hookSpecificOutput.additionalContext;
  expect(note).toContain("session 92% (resets 2026-09-27 08:09 UTC)");
  expect(note).toContain("weekly 40% (resets 2026-10-02 17:00 UTC)");
  expect(note).toContain("`write-session-handoff`");
});

/** A main transcript: one entry per line, as Claude Code writes it. */
function transcript(...entries) {
  const file = path.join(tmp("dotclaude-transcript-"), "main.jsonl");
  fs.writeFileSync(
    file,
    `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
  return file;
}

const response = (input, cached, extra = {}) => ({
  type: "assistant",
  isSidechain: false,
  message: {
    usage: {
      input_tokens: input,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 1_000,
      output_tokens: 500,
    },
  },
  ...extra,
});

test("mainContextTokens reads the last main response, or a later compaction", () => {
  expect(
    mainContextTokens(transcript(response(5, 20_000), response(10, 90_000))),
  ).toBe(91_010);
  // A sidechain entry is not the main context.
  expect(
    mainContextTokens(
      transcript(
        response(10, 90_000),
        response(10, 5_000, { isSidechain: true }),
      ),
    ),
  ).toBe(91_010);
  const compacted = transcript(response(10, 118_000), {
    type: "system",
    subtype: "compact_boundary",
    isSidechain: false,
    compactMetadata: {
      trigger: "auto",
      preTokens: 119_010,
      postTokens: 19_815,
    },
  });
  expect(mainContextTokens(compacted)).toBe(19_815);
  expect(mainContextTokens(path.join(tmp("dotclaude-none-"), "x.jsonl"))).toBe(
    null,
  );
});

test("a context note tells Claude its context size past the note bound", () => {
  const prompt = (file) =>
    hook(
      "user-prompt-submit/note-usage-limits.mjs",
      { session_id: "s5", prompt: "next step", transcript_path: file },
      { CLAUDE_CONFIG_DIR: tmp("dotclaude-none-") },
    );
  const below = CONTEXT_NOTE_TOKENS - 20_000;
  expect(prompt(transcript(response(10, below)))).toBe(null);
  const above = CONTEXT_NOTE_TOKENS + 12_000;
  const note = prompt(transcript(response(0, above - 1_000))).hookSpecificOutput
    .additionalContext;
  expect(note).toMatch(/^\[dotclaude\] <context_use/);
  expect(note).toContain(`${k(above)} tokens`);
  expect(note).toContain("`write-session-handoff`");
  expect(note).toContain("`/clear`");
  // The note repeats on each prompt past the bound.
  expect(prompt(transcript(response(0, above - 1_000)))).not.toBe(null);
  expect(
    hook(
      "user-prompt-submit/note-usage-limits.mjs",
      {
        session_id: "s5",
        prompt: "next step",
        transcript_path: transcript(response(0, above)),
      },
      { CLAUDE_PLUGIN_OPTION_USAGE_NOTES: "false" },
    ),
  ).toBe(null);
});

test("a tool call past the note bound tells the main agent once per crossing", () => {
  const env = {
    CLAUDE_CONFIG_DIR: tmp("dotclaude-none-"),
    CLAUDE_PLUGIN_DATA: tmp("dotclaude-data-"),
  };
  const tool = (file, extra = {}) =>
    hook(
      "post-tool-use/note-context-size.mjs",
      {
        session_id: "run-1",
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        transcript_path: file,
        ...extra,
      },
      env,
    )?.hookSpecificOutput.additionalContext ?? null;
  const prompt = (file) =>
    hook(
      "user-prompt-submit/note-usage-limits.mjs",
      { session_id: "run-1", prompt: "next step", transcript_path: file },
      env,
    );
  const below = transcript(response(10, CONTEXT_NOTE_TOKENS - 20_000));
  const above = transcript(response(0, CONTEXT_NOTE_TOKENS + 11_000));
  expect(tool(below)).toBe(null);
  expect(tool(above, { agent_id: "a1" }), "a subagent's tool call").toBe(null);
  expect(tool(above)).toContain(`${k(CONTEXT_NOTE_TOKENS + 12_000)} tokens`);
  expect(tool(above), "once per crossing").toBe(null);
  // After a compaction the context is under the bound, so the next crossing
  // gives a new note.
  expect(tool(below)).toBe(null);
  expect(tool(above)).toContain("`write-session-handoff`");
  // A note after a prompt counts, so the next tool call does not repeat it.
  expect(tool(below)).toBe(null);
  expect(prompt(above)).not.toBe(null);
  expect(tool(above)).toBe(null);
  expect(
    hook(
      "post-tool-use/note-context-size.mjs",
      { session_id: "run-2", transcript_path: above },
      { ...env, CLAUDE_PLUGIN_OPTION_USAGE_NOTES: "false" },
    ),
  ).toBe(null);
});

test("readUsage returns the reset times", () => {
  const usage = readUsage({
    CLAUDE_CONFIG_DIR: usageDir(60_000, {
      session: 100,
      weekly: 40,
      sessionReset: "2026-09-27T08:09:59.549386+00:00",
    }),
  });
  expect(usage.sessionResetsAt).toBe(Date.parse("2026-09-27T08:09:59.549Z"));
  expect(usage.weeklyResetsAt).toBe(null);
});

test("a usage-limit stop shows the limit, its reset, and the resume command", () => {
  const stop = (env, input = {}) =>
    hook(
      "stop-failure/notify-rate-limit.mjs",
      { session_id: "s9", error: "rate_limit", ...input },
      { TERM_PROGRAM: "ghostty", TZ: "UTC", ...env },
    );
  const reset = "2026-09-27T08:10:00Z";
  const session = stop({
    CLAUDE_CONFIG_DIR: usageDir(60_000, {
      session: 100,
      weekly: 40,
      sessionReset: reset,
    }),
  }).terminalSequence;
  // The time is in the user's locale, so allow a 12-hour clock.
  expect(session.startsWith("\u001b]777;notify;Claude Code;")).toBe(true);
  expect(session.endsWith("\u0007")).toBe(true);
  expect(session).toMatch(
    /\bsession\b.*\b0?8:10( AM)?\b.*`?claude --resume s9/,
  );
  const weekly = stop({
    TERM_PROGRAM: "iTerm.app",
    CLAUDE_CONFIG_DIR: usageDir(60_000, {
      session: 10,
      weekly: 100,
      weeklyReset: reset,
    }),
  }).terminalSequence;
  expect(weekly.startsWith("\u001b]9;")).toBe(true);
  expect(weekly).toMatch(/\bweekly\b.*\bSun,? 0?8:10( AM)?\b/);
  const unknown = stop({ CLAUDE_CONFIG_DIR: tmp("dotclaude-none-") });
  expect(unknown.terminalSequence).toContain("claude --resume s9");
  expect(unknown.terminalSequence).not.toMatch(/\d:\d\d/);
  expect(stop({}, { error: "overloaded" })).toBe(null);
  expect(stop({ CLAUDE_PLUGIN_OPTION_USAGE_NOTES: "false" })).toBe(null);
});
