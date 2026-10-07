// statusLine: reads the status JSON of Claude Code on stdin and prints one line:
// the model and effort, the context against the window, the OpenSpec change, and the 5-hour limit.
// Compaction is off, so the context part turns yellow and red as the session nears its stop.
// It calls no model, network, or CLI.

import fs from "node:fs";
import path from "node:path";
import { CONTEXT_WINDOW, USAGE_LEVELS } from "../lib/budget.mjs";

const color = (pct, text) => {
  const code = pct >= USAGE_LEVELS[1] ? 31 : pct >= USAGE_LEVELS[0] ? 33 : 0;
  return code ? `\x1b[${code}m${text}\x1b[0m` : text;
};
const k = (n) => `${Math.round(n / 1000)}k`;

/** The newest OpenSpec change in `dir` that has a `tasks.md`, with its done and total task counts. */
function openspecChange(dir) {
  const changes = path.join(dir, "openspec", "changes");
  let newest = null;
  try {
    for (const id of fs.readdirSync(changes)) {
      if (id === "archive") continue;
      const file = path.join(changes, id, "tasks.md");
      if (!fs.existsSync(file)) continue;
      const mtime = fs.statSync(file).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { id, file, mtime };
    }
  } catch {
    return null;
  }
  if (!newest) return null;
  const text = fs.readFileSync(newest.file, "utf8");
  const done = text.match(/^\s*[-*] \[[xX]\]/gm)?.length ?? 0;
  const open = text.match(/^\s*[-*] \[ \]/gm)?.length ?? 0;
  return { id: newest.id, done, total: done + open };
}

/** The status line text for the parsed status JSON `data`. */
function render(data) {
  const parts = [];
  const model = data.model?.display_name ?? data.model?.id;
  if (model)
    parts.push(data.effort?.level ? `${model} ${data.effort.level}` : model);
  const used = data.context_window?.total_input_tokens ?? 0;
  const window = Math.min(
    data.context_window?.context_window_size || CONTEXT_WINDOW,
    CONTEXT_WINDOW,
  );
  const pct = Math.round((used / window) * 100);
  parts.push(color(pct, `${k(used)}/${k(window)} ${pct}%`));
  const dir = data.workspace?.project_dir || data.cwd || process.cwd();
  const change = openspecChange(dir);
  if (change) parts.push(`${change.id} ${change.done}/${change.total}`);
  const fiveHour = data.rate_limits?.five_hour?.used_percentage;
  if (fiveHour !== undefined)
    parts.push(color(fiveHour, `5h ${Math.round(fiveHour)}%`));
  return parts.join(" · ");
}

// The launcher stub imports this file, so it runs on import.
try {
  const data = JSON.parse(fs.readFileSync(0, "utf8"));
  console.log(render(data && typeof data === "object" ? data : {}));
} catch {
  console.log("");
}
