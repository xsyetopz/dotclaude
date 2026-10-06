// The hooks module of dotclaude-modder.
// It enforces clause 17 of the dotclaude Terms of Use:
// it denies a Bash call that stops processes by name or by pattern,
// because the name can also match the shell of Claude or other apps of the user.
// `um win kill <pid>` stops one process by its PID.

// The first pattern matches `pkill` and `killall` only in command position,
// so that `grep pkill notes.md` passes.
const KILL_BY_NAME = [
  /(?:^|[;&|(`"'\n]|\$\()\s*(?:(?:sudo|env|nohup|exec|command|time)\s+(?:-\S+\s+)*)*(?:pkill|killall)\b/,
  /\btaskkill\b[^;&|\n]*\/(?:im|fi)\b/i,
  /\b(?:Stop-Process|spps)\b[^;&|\n]*\s-(?:n|na|nam|name|processname)\b/i,
  /\|\s*(?:Stop-Process|spps)\b/i,
  /\bkill\b[^;&|\n]*(?:\$\(|`)\s*(?:pgrep|pidof)\b/,
  /\|\s*xargs\b[^;&|\n]*\bkill\b/,
];

export const KILL_REASON =
  "This command stops processes by name or by pattern. A name can also match your own shell or other apps of the user. Find the PID with `um win ps`, and stop that one process with `um win kill <pid>`. This is clause 17 of the dotclaude Terms of Use.";

/** True when `command` stops processes by name or by pattern. */
export const killsByName = (command) =>
  KILL_BY_NAME.some((re) => re.test(command));

export function register(on) {
  on("tool.call", async (_$, e, next) =>
    e.tool === "Bash" && killsByName(String(e.command ?? ""))
      ? { deny: KILL_REASON }
      : next(e),
  );
}
