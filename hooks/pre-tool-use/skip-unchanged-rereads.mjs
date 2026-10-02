#!/usr/bin/env bun
// PreToolUse hook for Bash and Read: deny a full read of a file that the same
// agent already read in full and that did not change since. Claude Code skips
// an unchanged `Read` after a `Read` itself, so this covers a plain `cat`, a
// `Read` after a `cat`, and a `cat` after a `Read`. The earlier output is
// still in the context, and each turn re-reads the whole context, so a second
// copy costs usage on every later turn. Compaction clears the record
// (`pre-compact/save-recent-prompts.mjs`), because the summary drops the
// content.

import path from "node:path";
import { preToolDecision, run } from "../lib/_common.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { fullReads, load, readStamp } from "../lib/_ledger.mjs";
import { logVerdict } from "../lib/_verdicts.mjs";

/** Absolute paths that this call reads in full, or []. */
function targets(data) {
  const input = data.tool_input ?? {};
  if (data.tool_name === "Bash")
    return fullReads(
      input.command,
      data.cwd || projectRoot(nodeIo(data), data),
    );
  if (data.tool_name !== "Read" || !input.file_path) return [];
  if (input.offset || input.limit) return [];
  return [path.resolve(projectRoot(nodeIo(data), data), input.file_path)];
}

run((data) => {
  if (!option(process.env, "guard_bash") || !data.session_id) return;
  const files = targets(data);
  if (!files.length) return;
  const reads = load(data.session_id, data.agent_id).reads ?? {};
  const earlier = [];
  for (const abs of files) {
    const seen = reads[abs];
    const now = readStamp(abs);
    if (!seen || !now) return;
    if (seen.size !== now.size || seen.mtimeMs !== now.mtimeMs) return;
    earlier.push(`${path.basename(abs)} (by ${seen.how})`);
  }
  const reason = `You already read ${earlier.join(", ")} in full, and the file did not change since. Use that earlier output, because a second copy adds the same text to the context again. If you need only part of the file, use \`Read\` with \`offset\` and \`limit\`.`;
  logVerdict(data, "deny", reason);
  preToolDecision("deny", reason);
});
