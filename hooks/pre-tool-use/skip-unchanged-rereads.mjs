// PreToolUse hook for Bash and Read: deny a full read of a file that the same
// agent already read in full and that did not change since. Claude Code skips
// an unchanged `Read` after a `Read` itself, so this covers a plain `cat`, a
// `Read` after a `cat`, and a `cat` after a `Read`. The earlier output is
// still in the context, and each turn re-reads the whole context, so a second
// copy costs usage on every later turn. Compaction clears the record
// (`pre-compact/save-recent-prompts.mjs`), because the summary drops the
// content.

import { option, preToolOutput, projectRoot } from "../lib/_core.mjs";
import { fullReads, load, readStamp } from "../lib/_ledger.mjs";
import { pathFor } from "../lib/_path.mjs";
import { logVerdict } from "../lib/_verdicts.mjs";

/** Absolute paths that this call reads in full, or []. */
function targets(io, data) {
  const path = pathFor(io.platform);
  const input = data.tool_input ?? {};
  if (data.tool_name === "Bash")
    return fullReads(
      input.command,
      path.resolve(io.cwd, data.cwd || projectRoot(io, data)),
      io.home,
      io.platform,
    );
  if (data.tool_name !== "Read" || !input.file_path) return [];
  if (input.offset || input.limit) return [];
  return [path.resolve(projectRoot(io, data), input.file_path)];
}

export default async function (io, data) {
  if (!option(io.env, "guard_bash") || !data.session_id) return;
  const path = pathFor(io.platform);
  const files = targets(io, data);
  if (!files.length) return;
  const reads = (await load(io, data.session_id, data.agent_id)).reads ?? {};
  const earlier = [];
  for (const abs of files) {
    const seen = reads[abs];
    const now = await readStamp(io, abs);
    if (!seen || !now) return;
    if (seen.size !== now.size || seen.mtimeMs !== now.mtimeMs) return;
    earlier.push(`${path.basename(abs)} (by ${seen.how})`);
  }
  const reason = `You already read ${earlier.join(", ")} in full, and the file did not change since. Use that earlier output, because a second copy adds the same text to the context again. If you need only part of the file, use \`Read\` with \`offset\` and \`limit\`.`;
  await logVerdict(io, data, "deny", reason);
  return preToolOutput("deny", reason);
}
