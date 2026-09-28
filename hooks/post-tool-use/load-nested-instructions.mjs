#!/usr/bin/env bun
// PostToolUse(Bash): add the subdirectory CLAUDE.md files that a Read of the
// same paths would have loaded (#90450). Each file is added once per session
// or subagent: the hook skips files the transcript shows Claude Code loaded,
// and files it added before.

import fs from "node:fs";
import path from "node:path";
import { emit, option, projectRoot, run, stateDir } from "../lib/_common.mjs";
import {
  contextFor,
  instructionFiles,
  loadedInTranscript,
  readPaths,
} from "../lib/_nested-instructions.mjs";

function stateFile(data) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  const agent = data.agent_id ? `.${safe(data.agent_id)}` : "";
  return path.join(
    stateDir(),
    `${safe(data.session_id || "unknown")}${agent}.nested-instructions.json`,
  );
}

run((data) => {
  if (!option("nested_instructions")) return;
  const command = data.tool_input?.command;
  if (typeof command !== "string") return;
  const root = projectRoot(data);
  const cwd = data.cwd ? path.resolve(data.cwd) : root;
  const wanted = new Set();
  for (const p of readPaths(command, cwd, root))
    for (const f of instructionFiles(p, root)) wanted.add(f);
  if (!wanted.size) return;

  const file = stateFile(data);
  let added = [];
  try {
    added = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    added = [];
  }
  const skip = new Set(added);
  // A subagent's context does not hold what the main transcript loaded.
  if (!data.agent_id)
    for (const p of loadedInTranscript(data.transcript_path)) skip.add(p);
  const fresh = [...wanted].filter((f) => !skip.has(f));
  if (!fresh.length) return;
  const text = contextFor(fresh, root);
  if (!text) return;
  fs.writeFileSync(file, JSON.stringify([...added, ...fresh]));
  emit({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: text,
    },
  });
});
