// The subagent rules of the operating spec: the progress file of each subagent,
// and the subagent section that the main agent does not get at session start.

import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextFor as sessionContext } from "../../plugins/dotclaude/hooks/session-start/add-session-context.mjs";
import {
  contextFor,
  SUBAGENT_CONTEXT,
} from "../../plugins/dotclaude/hooks/subagent-start/add-subagent-context.mjs";
import {
  PROGRESS_DIR,
  progressFile,
} from "../../plugins/dotclaude/lib/notes/progress.mjs";
import {
  rules,
  SPEC,
  section,
  sectionTag,
} from "../../plugins/dotclaude/lib/terms.mjs";

const ID = "subagent-progress";

test("a progress file is named by a safe agent ID only", () => {
  expect(progressFile("a1")).toBe(join(PROGRESS_DIR, "a1.md"));
  for (const id of ["../x", "a/b", "", undefined, "a b"])
    expect(progressFile(id)).toBeNull();
});

test("each subagent gets the path of its progress file", () => {
  const file = progressFile("a1");
  const context = contextFor({ agent_id: "a1" });
  expect(context).toStartWith(`${SPEC}\n\n${sectionTag(ID)}`);
  expect(context).toContain(`add one line to \`${file}\``);
  expect(context).not.toContain("<progress file>");
  expect(contextFor({ agent_id: "../x" })).toBe(SUBAGENT_CONTEXT);
  expect(contextFor({})).toBe(SUBAGENT_CONTEXT);
});

test("a subagent without a progress file gets the other subagent rules", () => {
  expect(SUBAGENT_CONTEXT).toStartWith(`${SPEC}\n\n${sectionTag(ID)}`);
  expect(SUBAGENT_CONTEXT).toContain("**Not verified**");
  expect(SUBAGENT_CONTEXT).not.toContain("progress file");
  expect(SUBAGENT_CONTEXT).not.toContain("<progress file>");
});

test("the main agent does not get the subagent section", () => {
  const root = mkdtempSync(join(tmpdir(), "ss-"));
  const text = sessionContext({ source: "startup" }, root, "max").join("\n");
  expect(text).not.toContain(sectionTag(ID));
  expect(text).not.toContain(section(ID, rules(ID)));
});

test("the subagent contexts have no semicolon", () => {
  for (const text of [SUBAGENT_CONTEXT, contextFor({ agent_id: "a1" })])
    expect(text).not.toContain(";");
});
