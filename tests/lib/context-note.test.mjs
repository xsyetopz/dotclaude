// The context note on the io seam: the size and the compaction count come
// from `io.session`, and the hooks module gives no count.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMPACTIONS_BEFORE_HANDOFF,
  CONTEXT_NOTE_TOKENS,
} from "../../hooks/lib/_budget.mjs";
import { contextNote } from "../../hooks/lib/_context-note.mjs";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";

function noteIo(tokens, count) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-data-"));
  return {
    ...nodeIo(),
    env: { CLAUDE_PLUGIN_DATA: data },
    session: {
      mainContextTokens: async () => tokens,
      compactions: async () => count,
    },
  };
}

const data = { session_id: "s1" };

test("the context note comes once past the bound after the allowed compactions", async () => {
  const io = noteIo(CONTEXT_NOTE_TOKENS + 1, COMPACTIONS_BEFORE_HANDOFF);
  expect(await contextNote(io, data, true)).toContain("handoff");
  expect(await contextNote(io, data, true)).toBeNull();
});

test("no context note when the count or the size is not known", async () => {
  expect(
    await contextNote(noteIo(CONTEXT_NOTE_TOKENS + 1, null), data, true),
  ).toBeNull();
  expect(
    await contextNote(noteIo(null, COMPACTIONS_BEFORE_HANDOFF), data, true),
  ).toBeNull();
});
