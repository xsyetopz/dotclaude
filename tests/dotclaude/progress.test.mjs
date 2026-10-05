// The subagent progress clause: the progress file of each subagent,
// and the clause for the main agent at session start.

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
  MAIN_PROGRESS,
  PROGRESS_DIR,
  progressFile,
  subagentProgress,
} from "../../plugins/dotclaude/lib/notes/progress.mjs";
import { clauseTag } from "../../plugins/dotclaude/lib/terms.mjs";

test("a progress file is named by a safe agent ID only", () => {
  expect(progressFile("a1")).toBe(join(PROGRESS_DIR, "a1.md"));
  for (const id of ["../x", "a/b", "", undefined, "a b"])
    expect(progressFile(id)).toBeNull();
});

test("each subagent gets the path of its progress file", () => {
  expect(contextFor({ agent_id: "a1" })).toBe(
    `${SUBAGENT_CONTEXT}\n\n${subagentProgress(progressFile("a1"))}`,
  );
  expect(contextFor({ agent_id: "../x" })).toBe(SUBAGENT_CONTEXT);
  expect(contextFor({})).toBe(SUBAGENT_CONTEXT);
});

test("the main agent gets the progress clause", () => {
  const root = mkdtempSync(join(tmpdir(), "ss-"));
  expect(sessionContext({ source: "startup" }, root, "max")).toContain(
    MAIN_PROGRESS,
  );
});

test("each progress clause is clause 15 and has no semicolon", () => {
  for (const text of [MAIN_PROGRESS, subagentProgress(progressFile("a1"))]) {
    expect(text).toStartWith(clauseTag("subagent-progress"));
    expect(text).not.toContain(";");
  }
});
