// Bash guard rules for writes to Claude Code's own configuration.
//
// In auto mode the classifier denies these writes as self-modification, even
// when the user asked for them. An "ask" from a hook skips the classifier and
// shows the user a permission prompt (Claude Code 2.1.283), so the user can
// approve the write.

const SCRIPTS = {
  "apply-settings": "a Claude Code settings file",
  "apply-claude-md": "the global `CLAUDE.md`",
  "apply-launcher": "the shell startup file and the system-prompt copy",
  "install-managed": "the managed settings (admin rights)",
};
const SCRIPT =
  /\b(apply-settings|apply-claude-md|apply-launcher|install-managed)\.mjs\b/g;

export const SETTINGS_PATH =
  /(^|[/"'\s])(\.claude\/settings(\.local)?\.json|managed-settings(\.json|\.d\b))/;

const WRITES_FILE =
  /(^|[^<&0-9])>|\btee\b|\b(sed|perl)\s+(-\w*\s+)*-i|\bsd\s|\b(mv|cp|install|dd|rm)\s|\b(python[0-9.]*|node|bun|deno|ruby)\s/;

export function settingsWrite(command) {
  const out = [];
  if (/(^|\s)--apply\b/.test(command))
    for (const [, name] of command.matchAll(SCRIPT))
      out.push([
        "ask",
        `\`${name}.mjs --apply\` changes ${SCRIPTS[name]}; approve to let it write`,
      ]);
  if (!out.length && SETTINGS_PATH.test(command) && WRITES_FILE.test(command))
    out.push([
      "ask",
      "command may write a Claude Code settings file; approve to let it write",
    ]);
  return out;
}
