// Bash guard rules for writes to Claude Code's own configuration.
//
// In auto mode the classifier denies these writes as self-modification, even
// when the user asked for them. For a Bash command, an "ask" from a hook
// shows the user a permission prompt (Claude Code 2.1.283), so the user can
// approve the write. This does not hold for Edit or Write on a settings file:
// Claude Code's own safety check on that path keeps the classifier in the
// pipeline ("hookAskFloor"), so a classifier deny stands over a hook's ask.

const SCRIPTS = {
  "apply-settings": "a Claude Code settings file",
  "apply-claude-md": "the global `CLAUDE.md`",
  "apply-statusline": "the user settings' `statusLine` and its stub",
  "install-managed": "the managed settings (admin rights)",
  migrate:
    "the shell startup files, the 0.16 system-prompt copy, and the renamed dotclaude options in the user settings",
};
// `migrate.mjs` is a common name, so it counts only in the setup skill.
const SCRIPT =
  /\b(apply-settings|apply-claude-md|apply-statusline|install-managed|(?<=setup[/\\]scripts[/\\])migrate)\.mjs\b/g;

export const SETTINGS_PATH =
  /(^|[/"'\s])(\.claude\/settings(\.local)?\.json|managed-settings(\.json|\.d\b))/;

// Shell writes, interpreter runs, and file-writing calls in inline code.
const WRITES_FILE =
  /(^|[^<&0-9])>|\btee\b|\b(sed|perl)\s+(-\w*\s+)*-i|\bsd\s|\b(mv|cp|install|dd|rm)\s|\b(python[0-9.]*|node|bun|deno|ruby)\s|\bopen\(.*["'][wax+]|\.(write_text|write_bytes|writeFileSync|writeFile|appendFileSync|copyFileSync|renameSync|rmSync|unlinkSync)\b|\bjson\.dump\b|\bBun\.write\b|\bDeno\.writeTextFile\b|\bshutil\.(copy|move)/;

/**
 * True when one line of the command names a settings file and writes a file.
 * A heredoc body that only mentions the path (a table, a list of names) is
 * data. A write through a variable on another line is not found, and then
 * Claude Code's normal permission flow applies.
 */
function writesSettings(command) {
  return command
    .replace(/\\\n/g, " ")
    .split("\n")
    .some((line) => SETTINGS_PATH.test(line) && WRITES_FILE.test(line));
}

export function settingsWrite(command) {
  const out = [];
  if (/(^|\s)--apply\b/.test(command))
    for (const [, name] of command.matchAll(SCRIPT))
      out.push([
        "ask",
        `\`${name}.mjs --apply\` changes ${SCRIPTS[name]}. Approve it to let it write`,
      ]);
  if (!out.length && writesSettings(command))
    out.push([
      "ask",
      "the command may write a Claude Code settings file. Approve it to let it write",
    ]);
  return out;
}
