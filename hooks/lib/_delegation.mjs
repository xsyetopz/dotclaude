// The count of read calls that the main conversation made since the last
// typed prompt or `Agent` call. The count is in a state file of the session,
// like the marker of the context note.

import { stateDir } from "./_core.mjs";
import { pathFor } from "./_path.mjs";
import { parse } from "./_shell.mjs";

const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const READ_PROGRAMS = new Set([
  "rg",
  "grep",
  "cat",
  "head",
  "tail",
  "fd",
  "find",
  "ls",
]);
const GIT_READS = new Set(["log", "show", "diff", "blame"]);
const INLINE_SCRIPT = new Set(["python3", "python", "node"]);

/** Whether the first simple command of a Bash command line reads. */
function bashReads(command) {
  const [cmd] = parse(String(command ?? "")).commands;
  if (!cmd) return false;
  // `cat > file` and `cat <<EOF > file` write.
  if (cmd.writes.length) return false;
  if (cmd.name === "sed") return cmd.args[0] === "-n";
  if (cmd.name === "git") return GIT_READS.has(cmd.args[0]);
  if (INLINE_SCRIPT.has(cmd.name)) return cmd.args[0] === "-";
  return READ_PROGRAMS.has(cmd.name);
}

/** Whether a tool call is a read call. */
export function isRead(data) {
  if (READ_TOOLS.has(data.tool_name)) return true;
  return data.tool_name === "Bash" && bashReads(data.tool_input?.command);
}

function countFile(io, data) {
  const safe = String(data.session_id || "unknown").replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  );
  return pathFor(io.platform).join(stateDir(io), `${safe}.reads`);
}

/**
 * Set the count to `n`. The hooks module cannot delete a file, so an empty
 * file counts as 0.
 */
export const setReads = (io, data, n) =>
  io.fs.write(countFile(io, data), String(n));

/** The count of read calls in the main conversation, 0 if none. */
export async function readCount(io, data) {
  const text = await io.fs.read(countFile(io, data)).catch(() => "");
  return Number.parseInt(text, 10) || 0;
}
