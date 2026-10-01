// The Claude Code versions dotclaude needs and was tested on, and the version
// of the running CLI, read without a `claude --version` spawn.

/** The first release with Sonnet 5.5, which the agents and the profile use. */
export const MIN_CLAUDE_CODE = "2.1.284";

/** The release this plugin version was built and tested against. */
export const TESTED_CLAUDE_CODE = "2.1.286";

/**
 * The running Claude Code version, such as "2.1.286", or null. The CLI puts
 * it in `AI_AGENT` (`claude-code_2-1-286_agent`) for every child process. A
 * native install also names it in the path of `CLAUDE_CODE_EXECPATH`.
 */
export function claudeVersion(env = process.env) {
  const agent = /^claude-code_(\d+)-(\d+)-(\d+)_/.exec(env.AI_AGENT ?? "");
  if (agent) return agent.slice(1).join(".");
  return (
    /[/\\]versions[/\\](\d+\.\d+\.\d+)$/.exec(
      env.CLAUDE_CODE_EXECPATH ?? "",
    )?.[1] ?? null
  );
}

/** True when dotted `version` sorts before `other`. */
export function olderThan(version, other) {
  const a = version.split(".").map(Number);
  const b = other.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}
