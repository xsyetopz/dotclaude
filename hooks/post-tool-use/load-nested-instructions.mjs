// PostToolUse(Bash): add the subdirectory CLAUDE.md files that a Read of the
// same paths would have loaded (#90450). Each file is added once per session
// or subagent: the hook skips files the transcript shows Claude Code loaded,
// and files it added before.

import { option, projectRoot, stateDir } from "../lib/_core.mjs";
import {
  contextFor,
  instructionFiles,
  readPaths,
} from "../lib/_nested-instructions.mjs";
import { pathFor } from "../lib/_path.mjs";

function stateFile(io, data) {
  const path = pathFor(io.platform);
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  const agent = data.agent_id ? `.${safe(data.agent_id)}` : "";
  return path.join(
    stateDir(io),
    `${safe(data.session_id || "unknown")}${agent}.nested-instructions.json`,
  );
}

export default async function (io, data) {
  const path = pathFor(io.platform);
  if (!option(io.env, "context_nested_instructions")) return;
  const command = data.tool_input?.command;
  if (typeof command !== "string") return;
  const root = projectRoot(io, data);
  const cwd = data.cwd ? path.resolve(io.cwd, data.cwd) : root;
  const wanted = new Set();
  for (const p of await readPaths(io, command, cwd, root))
    for (const f of await instructionFiles(io, p, root)) wanted.add(f);
  if (!wanted.size) return;

  const file = stateFile(io, data);
  let added = [];
  try {
    added = JSON.parse(await io.fs.read(file));
  } catch {
    added = [];
  }
  const skip = new Set(added);
  // A subagent's context does not hold what the main transcript loaded.
  // The hooks-module io always resolves null. A null is an empty set. The
  // state file above stops a repeat in the same session, so each file is
  // added once at most. A file that Claude Code loaded through `Read` can
  // repeat once. This is safe, because a skip would drop instructions.
  if (!data.agent_id)
    for (const p of (await io.session.loadedNested()) ?? []) skip.add(p);
  const fresh = [...wanted].filter((f) => !skip.has(f));
  if (!fresh.length) return;
  const text = await contextFor(io, fresh, root);
  if (!text) return;
  await io.fs.write(file, JSON.stringify([...added, ...fresh]));
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: text,
    },
  };
}
