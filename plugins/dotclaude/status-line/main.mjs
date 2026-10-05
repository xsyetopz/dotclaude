// statusLine: reads Claude Code's status JSON on stdin and prints rows that
// wrap at $COLUMNS. Claude Code runs it every `STATUS_REFRESH_SECONDS`, which
// animates the warning glyphs. It calls no model or network, and slow reads
// go through `cached` in `sources.mjs`.

import fs from "node:fs";
import { renderMain } from "./render.mjs";
import { compactions, gitState, loopProgress, usageCopy } from "./sources.mjs";

try {
  const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
  const data = parsed && typeof parsed === "object" ? parsed : {};
  const now = Date.now();
  const dir = data.workspace?.current_dir || data.cwd || process.cwd();
  console.log(
    renderMain(data, {
      now,
      columns: (Number(process.env.COLUMNS) || 120) - 4,
      git: gitState(dir, now),
      loop: loopProgress(data.workspace?.project_dir || dir),
      compactions: compactions(data.transcript_path, now),
      // The `/usage` copy fills a window that the status JSON does not have
      // yet, and it is the only source of limit resets and extra usage.
      usage: usageCopy(process.env, now),
    }),
  );
} catch {
  console.log("");
}
