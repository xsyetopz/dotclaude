// Agent budget: `SubagentStart` and `SubagentStop` keep a count of running
// subagents per session, and an `Agent` call with `MAX_CONCURRENT_AGENTS`
// already running is denied before Claude Code refuses it.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { MAX_CONCURRENT_AGENTS } from "../../hooks/lib/_budget.mjs";
import { data, hook, session } from "../support/hooks.mjs";

const event = (script, hook_event_name) => (sid, agent_id) =>
  hook(script, {
    session_id: sid,
    agent_id,
    agent_type: "dotclaude:implementer",
    hook_event_name,
    transcript_path: path.join(data, "missing", `${sid}.jsonl`),
  });
const start = event("subagent-start/count-running-agents.mjs", "SubagentStart");
const stop = event("stop/count-running-agents.mjs", "SubagentStop");
const spawn = (sid) =>
  hook("pre-tool-use/prefer-dotclaude-agents.mjs", {
    session_id: sid,
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_input: { subagent_type: "dotclaude:implementer", prompt: "x" },
  })?.hookSpecificOutput ?? null;

test("a start with the cap running is denied, and a stop frees a place", () => {
  expect(MAX_CONCURRENT_AGENTS).toBe(5);
  const sid = session();
  for (let i = 0; i < MAX_CONCURRENT_AGENTS; i += 1) {
    expect(spawn(sid).permissionDecision).toBe("allow");
    start(sid, `a${i}`);
  }
  // A resume fires `SubagentStart` again for the same agent.
  start(sid, "a0");
  const out = spawn(sid);
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toContain("5 subagents");
  expect(out.permissionDecisionReason).toContain("`Monitor`");
  stop(sid, "a3");
  expect(spawn(sid).permissionDecision).toBe("allow");
});

test("a session with no count allows, and an idle marker does not count", () => {
  expect(spawn(session()).permissionDecision).toBe("allow");
  const sid = session();
  for (let i = 0; i < MAX_CONCURRENT_AGENTS; i += 1) start(sid, `b${i}`);
  expect(spawn(sid).permissionDecision).toBe("deny");
  // An interrupted agent can end without `SubagentStop`.
  const old = new Date(Date.now() - 11 * 60 * 1000);
  const marker = path.join(data, "sessions", `${sid}.b0.running`);
  fs.utimesSync(marker, old, old);
  expect(spawn(sid).permissionDecision).toBe("allow");
});

test("an old marker counts while the agent's transcript still changes", () => {
  const sid = session();
  const dir = path.join(data, "projects");
  fs.mkdirSync(path.join(dir, sid, "subagents"), { recursive: true });
  for (let i = 0; i < MAX_CONCURRENT_AGENTS; i += 1) {
    hook("subagent-start/count-running-agents.mjs", {
      session_id: sid,
      agent_id: `c${i}`,
      hook_event_name: "SubagentStart",
      transcript_path: path.join(dir, `${sid}.jsonl`),
    });
    fs.writeFileSync(path.join(dir, sid, "subagents", `agent-c${i}.jsonl`), "");
  }
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(path.join(data, "sessions", `${sid}.c0.running`), old, old);
  expect(spawn(sid).permissionDecision).toBe("deny");
});
