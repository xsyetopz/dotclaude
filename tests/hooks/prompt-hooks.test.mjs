// User prompt hook: /dotclaude: skills typed mid-message.

import { expect, test } from "bun:test";
import { hook } from "../support/hooks.mjs";

test("a /dotclaude: skill typed mid-message runs through the Skill tool", () => {
  const expand = (prompt, env = {}) =>
    hook(
      "user-prompt-submit/expand-inline-skill.mjs",
      { hook_event_name: "UserPromptSubmit", prompt },
      { CLAUDE_PLUGIN_ROOT: "", ...env },
    );
  const out = expand(
    "wrap up, then /dotclaude:write-session-handoff notes/h.md",
  ).hookSpecificOutput;
  expect(out.hookEventName).toBe("UserPromptSubmit");
  // The tool, the skill name, and the rest of the message as its arguments.
  expect(out.additionalContext).toContain("`Skill`");
  expect(out.additionalContext).toContain("`dotclaude:write-session-handoff`");
  expect(out.additionalContext).toContain('"wrap up, then notes/h.md"');
  expect(out.additionalContext).not.toMatch(/<skill /);
  expect(expand("/dotclaude:write-session-handoff h.md")).toBe(null);
  expect(expand("try /dotclaude:no-such-skill here")).toBe(null);
  // Pasted or quoted text names a skill without invoking it.
  expect(
    expand(
      'agreed:\n<pasted_content id="p1">\nwhen you run /dotclaude:write-session-handoff\n</pasted_content id="p1">\nok',
    ),
  ).toBe(null);
  expect(
    expand("> when you run /dotclaude:write-session-handoff\nagreed"),
  ).toBe(null);
  expect(
    expand(
      "```\nSessionStart:startup says: re-run /dotclaude:write-session-handoff\n```\nthis, too.",
    ),
  ).toBe(null);
  expect(
    expand("see:\n~~~~\nthen /dotclaude:write-session-handoff h.md"),
    "an unclosed fence runs to the end of the message",
  ).toBe(null);
  expect(
    expand("```\nlog\n```\nnow /dotclaude:write-session-handoff h.md")
      .hookSpecificOutput.additionalContext,
    "a name after the closing fence still runs",
  ).toMatch(/dotclaude:write-session-handoff/);
  expect(
    expand(
      "<task-notification>\n<result>see /dotclaude:write-session-handoff</result>\n</task-notification>",
    ),
  ).toBe(null);
  // A user-only skill refuses the Skill tool, so only the user can start it.
  const user = expand("before applying, /dotclaude:apply-settings-profile")
    .hookSpecificOutput.additionalContext;
  expect(user).toContain("`/dotclaude:apply-settings-profile`");
  expect(user).not.toContain("`Skill`");
  expect(user).not.toContain('"before applying,"');
});
