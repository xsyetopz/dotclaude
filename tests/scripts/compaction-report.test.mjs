// compaction-report: parts split at compactions, and whether a needed token
// was kept, read again, or came from neither.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { report, sessionParts } from "../../scripts/compaction-report.mjs";

const line = (entry) => JSON.stringify(entry);
const result = (text) =>
  line({
    type: "user",
    message: { content: [{ type: "tool_result", content: text }] },
  });
const use = (id, command) =>
  line({
    type: "assistant",
    message: {
      id,
      model: "claude-opus-5-5",
      usage: { cache_read_input_tokens: 1_000_000 },
      content: [{ type: "tool_use", input: { command } }],
    },
  });
const boundary = line({
  type: "system",
  subtype: "compact_boundary",
  compactMetadata: { preTokens: 118_000, postTokens: 20_000 },
});
const summary = (text) =>
  line({ type: "user", isCompactSummary: true, message: { content: text } });

function write(dir, name, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

test("a needed token is kept, read again, or from neither", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compaction-report-"));
  const file = write(path.join(root, "proj"), "s1.jsonl", [
    // Context gives this path before a tool result does, so it is never needed.
    line({ type: "user", message: { content: "see CLAUDE.md/rules.txt" } }),
    result(
      "src/kept_file.ts src/reread_file.ts src/lost_file.ts CLAUDE.md/rules.txt",
    ),
    use("m1", "cat src/kept_file.ts"),
    boundary,
    summary("Working in src/kept_file.ts"),
    result("src/reread_file.ts"),
    use(
      "m2",
      "cat src/kept_file.ts src/reread_file.ts src/lost_file.ts CLAUDE.md/rules.txt",
    ),
  ]);
  const parts = sessionParts(file);
  expect(parts.length).toBe(2);
  expect(parts[1].pre).toBe(118_000);
  expect(Object.fromEntries(parts[1].needed)).toEqual({
    "src/kept_file.ts": { from: 0, how: "kept" },
    "src/reread_file.ts": { from: 0, how: "read" },
    "src/lost_file.ts": { from: 0, how: "neither" },
  });

  const r = report(root, new Date(0));
  expect(r.sessions).toBe(1);
  expect(r.parts[1]).toMatchObject({
    calls: 1,
    cost: 0,
    costPerCall: 0.2,
    medianPostTokens: 20_000,
    kept: { n: 3, keptPct: 33 },
  });
  // A session whose compaction came past --max-pre is left out.
  expect(report(root, new Date(0), 100_000).sessions).toBe(0);
  fs.rmSync(root, { recursive: true });
});

test("a transcript without a compaction has no parts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compaction-report-"));
  const file = write(root, "s.jsonl", [use("m1", "ls src/some_file.ts")]);
  expect(sessionParts(file)).toBe(null);
  fs.rmSync(root, { recursive: true });
});
