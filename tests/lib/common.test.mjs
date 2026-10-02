// dotclaude's per-session state is pruned so it does not grow without bound.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pruneState } from "../../hooks/lib/_core.mjs";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";

test("state files untouched for over 30 days are pruned; newer ones stay", async () => {
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(
    path.join(os.tmpdir(), "dotclaude-state-"),
  );
  const dir = path.join(process.env.CLAUDE_PLUGIN_DATA, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [name, ageDays] of [
    ["old.json", 31],
    ["recent.json", 29],
    ["today.usage-level", 0],
  ]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "{}");
    const at = new Date(now - ageDays * day);
    fs.utimesSync(file, at, at);
  }
  expect(await pruneState(nodeIo(), now)).toBe(1);
  expect(fs.readdirSync(dir).sort()).toStrictEqual([
    "recent.json",
    "today.usage-level",
  ]);
});
