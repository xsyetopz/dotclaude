#!/usr/bin/env bun
// PostToolUse(Bash): add the subdirectory CLAUDE.md files that a Read of the
// same paths would have loaded (#90450). Each file is added once per session
// or subagent: the hook skips files the transcript shows Claude Code loaded,
// and files it added before.

import path from "node:path";
import { emit, run } from "../lib/_common.mjs";
import { option, projectRoot, stateDir } from "../lib/_core.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import {
  contextFor,
  instructionFiles,
  readPaths,
} from "../lib/_nested-instructions.mjs";

function stateFile(io, data) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  const agent = data.agent_id ? `.${safe(data.agent_id)}` : "";
  return path.join(
    stateDir(io),
    `${safe(data.session_id || "unknown")}${agent}.nested-instructions.json`,
  );
}

run(async (data) => {
  const io = nodeIo(data);
  if (!option(process.env, "context_nested_instructions")) return;
  const command = data.tool_input?.command;
  if (typeof command !== "string") return;
  const root = projectRoot(io, data);
  const cwd = data.cwd ? path.resolve(data.cwd) : root;
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
  // The hooks-module io always resolves null, so there each file is added
  // again on each read. A null is an empty set.
  if (!data.agent_id)
    for (const p of (await io.session.loadedNested()) ?? []) skip.add(p);
  const fresh = [...wanted].filter((f) => !skip.has(f));
  if (!fresh.length) return;
  const text = await contextFor(io, fresh, root);
  if (!text) return;
  await io.fs.write(file, JSON.stringify([...added, ...fresh]));
  emit({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: text,
    },
  });
});
