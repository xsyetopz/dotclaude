// PostToolUse / PostToolUseFailure hook: record edits and check runs in the
// session ledger, and mark an asked guard decision as approved. Prints
// nothing.

import { checkInfo } from "../lib/_check-command.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import {
  codeFile,
  fullReads,
  lastRunSeq,
  load,
  outputShowsFailure,
  recordRead,
  save,
  shellWrites,
  withLedger,
} from "../lib/_ledger.mjs";
import { pathFor } from "../lib/_path.mjs";
import { findTestCommand } from "../lib/_test-command.mjs";
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

/** Result of a finished test/build/lint command, with its kind (`run` or `static`), or undefined when it doesn't count. */
function checkRun(data, project) {
  const input = data.tool_input ?? {};
  const info =
    typeof input.command === "string"
      ? checkInfo(input.command, project)
      : undefined;
  if (!info) return undefined;
  const { command: check, kind } = info;
  if (input.run_in_background) return undefined; // result arrives later
  const flat = check.replace(/\s+/g, " ").replaceAll("`", "'");
  const recorded = flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
  if (data.hook_event_name === "PostToolUseFailure") {
    if (data.is_interrupt) return undefined;
    const code = /^Exit code (\d+)/.exec(data.error ?? "")?.[1];
    return {
      command: recorded,
      kind,
      ok: false,
      code: code ? Number(code) : null,
    };
  }
  const response = data.tool_response ?? {};
  if (response.interrupted) return undefined;
  const output = `${response.stdout ?? ""}\n${response.stderr ?? ""}`.slice(
    -20000,
  );
  return { command: recorded, kind, ok: !outputShowsFailure(output), code: 0 };
}

/** Every path this session (or subagent) wrote, so compaction can tell its
 * changes from the user's. Bounded to keep the ledger small. */
function recordEdited(state, rel) {
  const list = (state.edited ?? []).filter((p) => p !== rel);
  list.push(rel);
  state.edited = list.slice(-300);
}

/**
 * The test commands that the project names, when an edit has no check after it.
 * The lookup reads files, so it runs only when the gate needs a check.
 */
async function projectChecks(io, data, state) {
  if (!state.lastEdit || state.lastEdit.seq <= lastRunSeq(state)) return [];
  return (await findTestCommand(io, projectRoot(io, data)))?.commands ?? [];
}

export default async function (io, data) {
  await approveAsk(io, data);
  if (
    !option(io.env, "gate_verify") &&
    !option(io.env, "context_compact_carryover") &&
    !option(io.env, "guard_bash")
  )
    return;
  await withLedger(io, data.session_id, data.agent_id, () => record(io, data));
}

async function record(io, data) {
  const path = pathFor(io.platform);
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
      const result = checkRun(data, await projectChecks(io, data, state));
      // A check in the same command runs after its writes (`... > f && make`).
      if (result) {
        if (written.length) state.seq += 1;
        state.lastCheck = { seq: state.seq, ...result };
        // The gate needs the last passing `run` check apart from the last
        // check, and a failed `run` check that a later `static` check hides.
        if (result.kind === "run") {
          if (result.ok) {
            state.lastRunSeq = state.seq;
            state.failedRun = null;
          } else state.failedRun = { seq: state.seq, ...result };
        }
      }
      if (!written.length && !result && !reads.length) return;
      break;
    }
    default:
      return;
  }
  await save(io, data.session_id, data.agent_id, state);
}
