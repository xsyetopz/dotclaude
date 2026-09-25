#!/usr/bin/env bun
// SessionStart(startup|resume): one line of context when the repository has a
// CodeGraph index.

import fs from "node:fs";
import path from "node:path";
import { emit, option, projectRoot, run } from "../lib/_common.mjs";

run((data) => {
  if (
    !option("codegraph_hint") ||
    !fs.existsSync(path.join(projectRoot(data), ".codegraph"))
  )
    return;
  emit({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        "This repository has a CodeGraph index (.codegraph/); codegraph_explore returns symbol source with callers and callees in one call.",
    },
  });
});
