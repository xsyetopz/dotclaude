// The session's task list (`TaskCreate`, `TaskUpdate`), read from the files
// Claude Code keeps at `<config>/tasks/<list>/<id>.json`. The list is
// `CLAUDE_CODE_TASK_LIST_ID` when set, else the session ID. A team's list is
// named for the team, which a hook cannot see, so that list reads as empty.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "-");

/** The task list directory for `sessionId`. */
export function taskListDir(sessionId, env = process.env) {
  const config = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(
    config,
    "tasks",
    safe(env.CLAUDE_CODE_TASK_LIST_ID || sessionId),
  );
}

/** Tasks that are pending or in progress, ordered by ID. */
export function openTasks(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const open = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    try {
      const task = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (task.status === "pending" || task.status === "in_progress")
        open.push({ id: String(task.id), subject: String(task.subject ?? "") });
    } catch {
      // A file Claude Code is writing now.
    }
  }
  return open.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}
