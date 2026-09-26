// Turn-limit handoffs and usage-limit notes, run as Claude Code runs hooks.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readUsage } from "../hooks/lib/_usage.mjs";

const HOOKS = path.resolve(import.meta.dirname, "../hooks");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function hook(script, input, env = {}) {
  const res = spawnSync("bun", [path.join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: tmp("dotclaude-data-"),
      ...env,
    },
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout ? JSON.parse(res.stdout) : null;
}

/** A main transcript whose agent `id` stopped at its turn limit. */
function cappedTranscript(id) {
  const file = path.join(tmp("dotclaude-transcript-"), "main.jsonl");
  const note = `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent "Slice" stopped at its 80-turn limit (partial result; SendMessage to task-id to continue)</summary>\n</task-notification>`;
  fs.writeFileSync(
    file,
    `${JSON.stringify({ type: "queue-operation", content: note })}\n`,
  );
  return file;
}

test("a capped agent gets one report request, then only a fresh agent", () => {
  const data = tmp("dotclaude-data-");
  const transcript = cappedTranscript("a243ca59c15b9edd2");
  const send = (to, message = "keep going") =>
    hook(
      "pre-tool-use/hand-off-capped-agents.mjs",
      {
        session_id: "s1",
        transcript_path: transcript,
        tool_name: "SendMessage",
        tool_input: { to, summary: "continue", message },
      },
      { CLAUDE_PLUGIN_DATA: data },
    );
  const first = send("a243ca59c15b9edd2").hookSpecificOutput;
  assert.equal(first.permissionDecision, "allow");
  assert.match(first.updatedInput.message, /Make no more tool calls/);
  assert.equal(first.updatedInput.to, "a243ca59c15b9edd2");
  assert.equal(first.updatedInput.summary, "continue");
  assert.match(first.additionalContext, /^\[dotclaude\] /);
  const second = send("a243ca59c15b9edd2").hookSpecificOutput;
  assert.equal(second.permissionDecision, "deny");
  assert.match(second.permissionDecisionReason, /^\[dotclaude\] .*fresh agent/);
  // An agent that finished normally can still get follow-ups.
  assert.equal(send("af9c9fd3c3f92e8b3"), null);
});

test("the turn-limit handoff can be turned off", () => {
  assert.equal(
    hook(
      "pre-tool-use/hand-off-capped-agents.mjs",
      {
        session_id: "s2",
        transcript_path: cappedTranscript("abcd1234"),
        tool_input: { to: "abcd1234", message: "go on" },
      },
      { CLAUDE_PLUGIN_OPTION_TURN_LIMIT_HANDOFF: "false" },
    ),
    null,
  );
});

/** A config dir whose cached usage was fetched `ageMs` ago. */
function usageDir(ageMs, { session, weekly, fable = 0 }) {
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
            { kind: "session", percent: session },
            { kind: "weekly_all", percent: weekly },
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
  assert.deepEqual(
    { session: fresh.session, weekly: fresh.weekly, fable: fresh.fable },
    { session: 28, weekly: 87, fable: 3 },
  );
  assert.equal(
    readUsage({
      CLAUDE_CONFIG_DIR: usageDir(2 * 3600_000, { session: 99, weekly: 99 }),
    }),
    null,
  );
});

test("usage notes fire once per level: 75%, then 90%", () => {
  const data = tmp("dotclaude-data-");
  const prompt = (dir) =>
    hook(
      "user-prompt-submit/note-usage-limits.mjs",
      { session_id: "s3", prompt: "next step" },
      { CLAUDE_PLUGIN_DATA: data, CLAUDE_CONFIG_DIR: dir },
    );
  assert.equal(prompt(usageDir(60_000, { session: 20, weekly: 50 })), null);
  const at87 = prompt(usageDir(60_000, { session: 28, weekly: 87 }))
    .hookSpecificOutput.additionalContext;
  assert.match(at87, /^\[dotclaude\] <usage_limits/);
  assert.match(at87, /weekly 87%/);
  assert.match(at87, /codex-worker/);
  assert.equal(prompt(usageDir(60_000, { session: 30, weekly: 88 })), null);
  const at91 = prompt(usageDir(60_000, { session: 91, weekly: 88 }))
    .hookSpecificOutput.additionalContext;
  assert.match(at91, /start no new fan-out/);
});
