# Release 0.9

Released 2026-09-28.
Adds secret redaction and fixes a few unclear instructions.
A `tail ~/.zshrc` had put an API key into the context of a session, so a new hook now removes such secrets before Claude sees them.

## Added

- Secret redaction: a new PostToolUse hook runs [gitleaks](https://github.com/gitleaks/gitleaks) on the output of every tool.
  It replaces each secret with `[REDACTED:<rule>]` before Claude sees it.
  - The rest of the output and its shape stay the same.
  - Claude gets a note that names the rules.
  - gitleaks runs from the temp directory with `--ignore-gitleaks-allow`.
    A `.gitleaks.toml` of a repository or a `gitleaks:allow` comment cannot turn redaction off.
  - A run takes about 30 ms.
  - The `secret_redaction` option (on by default) controls the hook.
  - Without gitleaks on `PATH`, output passes through and session start says so.
- `/dotclaude:setup-integrations`: reports the gitleaks version and tells how to install it.

## Changed

- `general-purpose` refusal: gives a route for plans.
  Draft the plan in plan mode, and have `dotclaude:plan-reviewer` review it.
  A session had sent plan drafting to `dotclaude:implementer`, which ran out of context, so the `implementer` description now says that it does not draft plans.
- Headroom proxy recipe: one recipe everywhere.

  ```bash
  DOTCLAUDE_LAUNCHER=1 headroom wrap claude --no-mcp --code-memory none -- --system-prompt-file ~/.claude/dotclaude/system-prompt.md
  ```

  - It starts the proxy, keeps the dotclaude system prompt, and stops the proxy when the session ends.
  - The README and the session-start notice told you to start `headroom proxy` by hand, which nothing stopped.
    The setup skill said `headroom wrap claude`.
  - `headroom unwrap claude --keep-mcp` stops a proxy that stays after a crash.
- Code comment on auto mode: it said that a hook "ask" lets the user approve any write to Claude settings.
  That is true for Bash commands only.
  For Edit or Write on a settings file, Claude Code keeps its classifier in the pipeline, and a classifier deny stands.
  No hook can turn that deny into a prompt.
  To make such an edit in auto mode, use one of these methods:
  - State the change in your message and retry.
  - Approve it in `/permissions` under recently denied.
  - Make the edit yourself.

Previous: [Release 0.8](Release-0.8) · Next: [Release 0.10](Release-0.10)
