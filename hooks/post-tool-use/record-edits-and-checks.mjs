// PostToolUse / PostToolUseFailure hook: record edits and check runs in the
// session ledger, and mark an asked guard decision as approved. Prints
// nothing.

import { option, projectRoot } from "../lib/_core.mjs";
import {
  checkCommand,
  codeFile,
  fullReads,
  load,
  outputShowsFailure,
  recordRead,
  save,
  shellWrites,
} from "../lib/_ledger.mjs";
import { pathFor } from "../lib/_path.mjs";
import { approveAsk } from "../lib/_verdicts.mjs";

/** Project-relative path an edit tool wrote, or null. */
function editedPath(io, data) {
  const path = pathFor(io.platform);
  if (data.hook_event_name === "PostToolUseFailure") return undefined;
  const input = data.tool_input ?? {};
  const file = input.file_path || input.notebook_path || "";
  if (!file) return undefined;
  // A relative `file` is from the hook's folder, as `path.resolve` did.
  const rel = path
    .relative(projectRoot(io, data), path.resolve(io.cwd, file))
    .split(path.sep)
    .join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return rel;
}

/** Result of a finished test/build/lint command, or null when it doesn't count. */
function checkRun(data) {
  const input = data.tool_input ?? {};
  const check =
    typeof input.command === "string" ? checkCommand(input.command) : undefined;
  if (!check) return undefined;
  if (input.run_in_background) return undefined; // result arrives later
  const flat = check.replace(/\s+/g, " ").replaceAll("`", "'");
  const recorded = flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
  if (data.hook_event_name === "PostToolUseFailure") {
    if (data.is_interrupt) return undefined;
    const code = /^Exit code (\d+)/.exec(data.error ?? "")?.[1];
    return { command: recorded, ok: false, code: code ? Number(code) : null };
  }
  const response = data.tool_response ?? {};
  if (response.interrupted) return undefined;
  const output = `${response.stdout ?? ""}\n${response.stderr ?? ""}`.slice(
    -20000,
  );
  return { command: recorded, ok: !outputShowsFailure(output), code: 0 };
}

/** Every path this session (or subagent) wrote, so compaction can tell its
 * changes from the user's. Bounded to keep the ledger small. */
function recordEdited(state, rel) {
  const list = (state.edited ?? []).filter((p) => p !== rel);
  list.push(rel);
  state.edited = list.slice(-300);
}

export default async function (io, data) {
  const path = pathFor(io.platform);
  await approveAsk(io, data);
  if (
    !option(io.env, "gate_verify") &&
    !option(io.env, "context_compact_carryover") &&
    !option(io.env, "guard_bash")
  )
    return;
  const state = await load(io, data.session_id, data.agent_id);
  state.seq += 1;
  switch (data.tool_name) {
    case "Read": {
      const input = data.tool_input ?? {};
      if (
        data.hook_event_name !== "PostToolUse" ||
        !input.file_path ||
        input.offset ||
        input.limit
      )
        return;
      await recordRead(
        io,
        state,
        path.resolve(projectRoot(io, data), input.file_path),
        "Read",
      );
      break;
    }
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit": {
      const rel = editedPath(io, data);
      if (!rel) return;
      recordEdited(state, rel);
      if (await codeFile(io, rel, projectRoot(io, data)))
        state.lastEdit = { seq: state.seq, path: rel };
      break;
    }
    case "Bash": {
      const command = data.tool_input?.command;
      // A relative `cwd` is from the hook's folder, as for `file_path`.
      const cwd = path.resolve(io.cwd, data.cwd || projectRoot(io, data));
      const written =
        data.hook_event_name === "PostToolUse" && typeof command === "string"
          ? await shellWrites(io, command, projectRoot(io, data), io.home, cwd)
          : [];
      for (const rel of written) {
        if (!(await codeFile(io, rel, projectRoot(io, data)))) continue;
        if (rel) state.lastEdit = { seq: state.seq, path: rel };
        break;
      }
      for (const rel of written) recordEdited(state, rel);
      const reads =
        data.hook_event_name === "PostToolUse"
          ? fullReads(command, cwd, io.home, io.platform)
          : [];
      for (const abs of reads)
        await recordRead(io, state, abs, `\`${command.trim()}\``);
      const result = checkRun(data);
      // A check in the same command runs after its writes (`... > f && make`).
      if (result) {
        if (written.length) state.seq += 1;
        state.lastCheck = { seq: state.seq, ...result };
      }
      if (!written.length && !result && !reads.length) return;
      break;
    }
    default:
      return;
  }
  await save(io, data.session_id, data.agent_id, state);
}
