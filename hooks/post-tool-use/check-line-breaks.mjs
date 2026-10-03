// PostToolUse(Edit|Write|MultiEdit|NotebookEdit): tell Claude when the text
// that it wrote breaks lines at a column, not by meaning. A hard wrap in
// instruction files and replies goes on into the text that Claude writes
// later (anthropics/claude-code#33666, openchamber/openchamber#4257).
// `semlf --hook claude` checks when it is on PATH. Otherwise the built-in
// check of `_linefeeds.mjs` runs. A PostToolUse action cannot block the
// edit, so each finding is a note.

import { option } from "../lib/_core.mjs";
import {
  findingsNote,
  lineBreakFindings,
  semlfReport,
  skipped,
  writtenTexts,
} from "../lib/_linefeeds.mjs";

export default async function (io, data) {
  if (!option(io.env, "context_line_breaks", false)) return;
  const input = data.tool_input ?? {};
  const file = input.file_path ?? input.notebook_path;
  if (typeof file !== "string" || skipped(file, io.tmp)) return;
  const texts = writtenTexts(input);
  if (!texts.length) return;
  const report = await semlfReport(io, data);
  // `semlf` checks the wraps by its own rules, so the built-in check then
  // looks only for split words.
  const name = input.cell_type === "markdown" ? `${file}.md` : file;
  const findings = texts.flatMap((text) =>
    lineBreakFindings(name, text, { wraps: report === null }),
  );
  const notes = [];
  if (report)
    notes.push(
      `<semlf_report>\n${report}\n</semlf_report>\n\`semlf\` examined the line breaks of the text that you wrote and gave this report.`,
    );
  if (findings.length) notes.push(findingsNote(file, findings));
  if (!notes.length) return;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: notes.join("\n\n"),
    },
  };
}
