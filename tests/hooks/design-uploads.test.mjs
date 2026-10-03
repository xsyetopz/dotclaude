// `DesignSync` writes outside the `/design-sync` skill, run as Claude Code runs hooks.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { isolatedHook as hook, tmp } from "../support/hooks.mjs";

/** A main transcript with `entries`, one JSON object per line. */
function transcript(...entries) {
  const file = path.join(tmp("dotclaude-transcript-"), "main.jsonl");
  fs.writeFileSync(file, entries.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return file;
}

const prompt = (content) => ({
  type: "user",
  message: { role: "user", content },
});

// The call from the JagFx session, which had no `/design-sync` skill.
const WRITE_FILES = {
  method: "write_files",
  projectId: "4d3882ca-e75d-4e97-bf19-a552fc5fc229",
  planId: "plan_01",
  files: [{ path: "brief.md", content: "# Brief\n" }],
};

const call = (input, file, env = {}) =>
  hook(
    "pre-tool-use/confirm-design-uploads.mjs",
    {
      session_id: "s1",
      transcript_path: file,
      tool_name: "DesignSync",
      tool_input: input,
    },
    env,
  );

test("a `DesignSync` write outside the skill asks the user", () => {
  const file = transcript(prompt("upload the brief to Claude Design"));
  const out = call(WRITE_FILES, file).hookSpecificOutput;
  expect(out.permissionDecision).toBe("ask");
  // Claude Code shows an `ask` reason to the user, so it has no tag.
  expect(out.permissionDecisionReason).toStartWith(
    "`DesignSync` `write_files`",
  );
  expect(out.permissionDecisionReason).toContain("`/design-sync`");
  for (const method of ["create_project", "finalize_plan", "delete_files"])
    expect(call({ method }, file).hookSpecificOutput.permissionDecision).toBe(
      "ask",
    );
  // A method that this guard does not know is a write until shown otherwise.
  expect(
    call({ method: "rename_project" }, file).hookSpecificOutput
      .permissionDecision,
  ).toBe("ask");
});

test("a `DesignSync` read passes", () => {
  const file = transcript(prompt("list my design projects"));
  for (const method of [
    "list_projects",
    "get_project",
    "list_files",
    "get_file",
    "report_validate",
  ])
    expect(call({ method }, file)).toBe(null);
});

test("a write passes after the user starts `/design-sync` or Claude calls its skill", () => {
  const typed = transcript(
    prompt(
      "<command-message>design-sync</command-message>\n<command-name>/design-sync</command-name>",
    ),
  );
  expect(call(WRITE_FILES, typed)).toBe(null);
  const called = transcript(prompt("sync the components"), {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", name: "Skill", input: { skill: "design-sync" } },
      ],
    },
  });
  expect(call(WRITE_FILES, called)).toBe(null);
  // A different skill does not count.
  const other = transcript(
    prompt("<command-name>/design-login</command-name>"),
  );
  expect(call(WRITE_FILES, other).hookSpecificOutput.permissionDecision).toBe(
    "ask",
  );
});

test("the `DesignSync` guard turns off with `guard_bash`", () => {
  expect(
    call(WRITE_FILES, transcript(prompt("upload")), {
      CLAUDE_PLUGIN_OPTION_GUARD_BASH: "false",
    }),
  ).toBe(null);
});
