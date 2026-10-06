// Clause 18: a prompt hook on Stop checks a done claim,
// and the contexts carry the note.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextFor as sessionContext } from "../../plugins/dotclaude/hooks/session-start/add-session-context.mjs";
import { SUBAGENT_CONTEXT } from "../../plugins/dotclaude/hooks/subagent-start/add-subagent-context.mjs";
import { clauseTag, TERMS } from "../../plugins/dotclaude/lib/terms.mjs";

const HOOKS = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../plugins/dotclaude/hooks/hooks.json"),
    "utf8",
  ),
).hooks;

const promptHook = (event) =>
  HOOKS[event][0].hooks.find((h) => h.type === "prompt");

test("only Stop has the clause 18 prompt hook, because it sends the transcript", () => {
  const stop = promptHook("Stop");
  expect(stop).toBeDefined();
  expect(HOOKS.SubagentStop).toBeUndefined();
  expect(stop.timeout).toBe(30);
});

test("subagents get the rule about a deny, because no other clause they get has it", () => {
  expect(SUBAGENT_CONTEXT).toContain(
    "Do not split, reword, or rebuild the denied command",
  );
});

test("the prompt reads the hook input, blocks once, and has no semicolons", () => {
  const { prompt } = promptHook("Stop");
  const n = TERMS.findIndex((t) => t.id === "known-defects") + 1;
  expect(n).toBe(18);
  for (const part of [
    "$ARGUMENTS",
    "`stop_hook_active`",
    "`last_assistant_message`",
    '{"ok": false',
    "**Not verified**",
    "count of failed tests",
    'Return {"ok": false} only when you can quote such words',
    `This is clause ${n} of the dotclaude Terms of Use.`,
  ])
    expect(prompt).toContain(part);
  expect(prompt).not.toContain(";");
});

test("no command hook checks done claims", () => {
  for (const h of HOOKS.Stop[0].hooks)
    expect(h.args?.[0] ?? "").not.toContain("unverified-done");
});

test("the main agent and each subagent get clause 18", () => {
  const root = mkdtempSync(join(tmpdir(), "ss-"));
  const tag = clauseTag("known-defects");
  expect(tag).toContain('clause="18"');
  expect(
    sessionContext({ source: "startup" }, root, "max").join("\n"),
  ).toContain(`${tag}\n<known_defects>`);
  expect(SUBAGENT_CONTEXT).toContain(`${tag}\n<known_defects>`);
});
