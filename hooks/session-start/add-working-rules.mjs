#!/usr/bin/env bun
// SessionStart: dotclaude's working rules from `working-rules.md`. They come
// from a hook and not from an output style, so they apply with every style,
// and each style holds only its reply-style rules (docs/working-rules.md).
//
// The rules have their own hooks.json command, because Claude Code keeps at
// most about 10,000 bytes of one command's output in the context
// (docs/dossier/prompt-surface.md). After a compaction Claude Code drops the
// first copy, so the rules come again. A resumed or forked transcript keeps
// its copy, so they do not.

import fs from "node:fs";
import path from "node:path";
import { emit, run } from "../lib/_common.mjs";
import { isSubagent } from "../lib/_transcript.mjs";

export const RULES_FILE = path.join(import.meta.dirname, "working-rules.md");

run(async (data) => {
  if (data.source === "resume" || data.source === "fork") return;
  if (isSubagent(data)) return;
  const rules = fs.readFileSync(RULES_FILE, "utf8").trim();
  emit({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `<working_rules>\n${rules}\n</working_rules>`,
    },
  });
});
