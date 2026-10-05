// Stop: send Claude back once when the turn edited files and no check ran
// after the last edit. `turn.complete` cannot block a stop, so this is a
// classic hook that reads the transcript. A stop after this reason
// (`stop_hook_active`) passes, so the gate fires once per turn.

import fs from "node:fs";
import path from "node:path";
import { checkCommands, lastTurn, verifyReason } from "../lib/_verify.mjs";

const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

let data = {};
try {
  data = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  // No input: no verdict.
}
if (!data.stop_hook_active && data.transcript_path) {
  const root = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
  const commands = checkCommands({
    justfile:
      read(path.join(root, "justfile")) || read(path.join(root, "Justfile")),
    packageJson: read(path.join(root, "package.json")),
    makefile: read(path.join(root, "Makefile")),
  });
  const reason = verifyReason(
    lastTurn(read(data.transcript_path)),
    commands,
    root,
  );
  if (reason)
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
}
