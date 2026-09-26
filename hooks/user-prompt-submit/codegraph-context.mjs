#!/usr/bin/env bun
// UserPromptSubmit: run `codegraph prompt-hook` for prompts the user typed, and
// skip the ones Claude Code generates itself (background-task notifications,
// subagent hand-backs), where CodeGraph context is paid for and never used.
// Replaces a global `codegraph prompt-hook` entry in settings.json.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { option, projectRoot, run } from "../lib/_common.mjs";

const GENERATED =
  /^\s*(<task-notification>|<agent-message\b|\[SYSTEM NOTIFICATION)|<task-notification>[\s\S]*<\/task-notification>\s*$/;

function userTyped(prompt) {
  return (
    typeof prompt === "string" &&
    prompt.trim() !== "" &&
    !GENERATED.test(prompt)
  );
}

run((data) => {
  if (!option("codegraph_prompt_context", false) || !userTyped(data.prompt))
    return;
  const root = projectRoot(data);
  if (!fs.existsSync(path.join(root, ".codegraph")) || !Bun.which("codegraph"))
    return;
  const res = spawnSync("codegraph", ["prompt-hook"], {
    input: JSON.stringify({ prompt: data.prompt, cwd: data.cwd || root }),
    encoding: "utf8",
    timeout: 8000,
  });
  if (res.status === 0 && res.stdout) process.stdout.write(res.stdout);
});
