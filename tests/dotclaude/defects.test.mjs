// Rule 12.1 of the operating spec: a prompt hook on Stop checks a done claim,
// and the contexts carry the rules of the section.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextFor as sessionContext } from "../../plugins/dotclaude/hooks/session-start/add-session-context.mjs";
import { SUBAGENT_CONTEXT } from "../../plugins/dotclaude/hooks/subagent-start/add-subagent-context.mjs";
import {
  cite,
  rules,
  SPEC,
  section,
} from "../../plugins/dotclaude/lib/terms.mjs";

const HOOKS = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../plugins/dotclaude/hooks/hooks.json"),
    "utf8",
  ),
).hooks;

const promptHook = (event) =>
  HOOKS[event][0].hooks.find((h) => h.type === "prompt");

test("only Stop has the done claim prompt hook, because it sends the transcript", () => {
  const stop = promptHook("Stop");
  expect(stop).toBeDefined();
  expect(HOOKS.SubagentStop).toBeUndefined();
  expect(stop.timeout).toBe(30);
});

test("subagents get the rule about a deny, because no other section they get has it", () => {
  expect(SUBAGENT_CONTEXT).toStartWith(SPEC);
  expect(SPEC).toContain("A hook deny is a decision of the user");
  expect(SPEC).toContain("do not get its result another way");
});

test("the prompt reads the hook input, blocks once, cites rule 12.1, and has no semicolons", () => {
  const { prompt } = promptHook("Stop");
  for (const part of [
    "$ARGUMENTS",
    "`stop_hook_active`",
    "`last_assistant_message`",
    '{"ok": false',
    "**Not verified**",
    "count of failed tests",
    'Return {"ok": false} only when you can quote such words',
    cite("done-claim"),
  ])
    expect(prompt).toContain(part);
  expect(cite("done-claim")).toBe(
    "This is rule 12.1 of the dotclaude operating spec.",
  );
  expect(prompt).not.toContain(";");
});

test("no command hook checks done claims", () => {
  for (const h of HOOKS.Stop[0].hooks)
    expect(h.args?.[0] ?? "").not.toContain("unverified-done");
});

test("the main agent gets the checks section, and each subagent gets the done rule", () => {
  const root = mkdtempSync(join(tmpdir(), "ss-"));
  expect(sessionContext({ source: "startup" }, root, "max")).toContain(
    section("known-defects", rules("known-defects")),
  );
  expect(SUBAGENT_CONTEXT).toContain("call a part done only when a check");
});
