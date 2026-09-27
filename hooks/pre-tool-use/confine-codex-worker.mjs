#!/usr/bin/env bun
// PreToolUse(Bash) for codex-worker: allow only its three steps (write the
// brief file, run run-codex.mjs, cat the report). Its Haiku model acts on the
// brief it forwards: given the task text, it read the files, edited them with
// a shell heredoc, and ran the acceptance command instead of starting Codex,
// and prompt rules against that did not hold. Not behind an option, since the
// agent does not work without it.

import { preToolDecision, run } from "../lib/_common.mjs";
import { parse } from "../lib/_shell.mjs";

const RUNNER = /(^|\/)run-codex\.mjs$/;
const BRIEF = /(^|\/)codex-brief-[\w.-]+\.md$/;
const REPORT = /\.report\.md$/;

function allowed(cmd) {
  const [name, ...args] = cmd.argv;
  if (!name) return true; // a bare variable assignment
  if (name === "bun" || name === "node")
    return !cmd.writes.length && args.some((a) => RUNNER.test(a));
  if (name !== "cat") return false;
  if (cmd.heredoc !== null)
    return !args.length && cmd.writes.length === 1 && BRIEF.test(cmd.writes[0]);
  return (
    !cmd.writes.length && args.length > 0 && args.every((a) => REPORT.test(a))
  );
}

run((data) => {
  if (data.agent_type !== "dotclaude:codex-worker") return;
  const command = data.tool_input?.command;
  if (typeof command !== "string") return;
  const parsed = parse(command);
  if (!parsed.unparsed.length && parsed.commands.every(allowed)) return;
  preToolDecision(
    "deny",
    "codex-worker does not do the task itself: Codex does. Run only the procedure: write the task text unchanged to a `codex-brief-<id>.md` file with `cat > <file> <<'EOF'` (only if you have no brief file), run `bun <run-codex.mjs> --brief <file> --dir <dir>`, and `cat` the `.report.md` file if the run moved to the background.",
  );
});
