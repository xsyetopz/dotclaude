# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

## [0.9.0] - 2026-09-28

### Added

- Secret redaction. A new PostToolUse hook runs
  [gitleaks](https://github.com/gitleaks/gitleaks) on the output of every tool
  and replaces each secret that it finds with `[REDACTED:<rule>]` before
  Claude sees it. The rest of the output and its shape stay the same, and
  Claude gets a note that names the rules. A `tail ~/.zshrc` had put an API
  key into the context. gitleaks runs from the temp directory with
  `--ignore-gitleaks-allow`, so a repository's `.gitleaks.toml` or a
  `gitleaks:allow` comment cannot turn redaction off. A run takes about
  30 ms. The `secret_redaction` option (on by default) controls it. Without
  gitleaks on `PATH`, output passes through and session start says so.
- `/dotclaude:setup-integrations` reports the gitleaks version and tells how
  to install it.

### Changed

- The `general-purpose` refusal now gives a route for plans: draft the plan
  in plan mode and have `dotclaude:plan-reviewer` review it. A session had
  sent plan drafting to `dotclaude:implementer`, which ran out of context.
  The implementer description says that it does not draft plans.
- One Headroom proxy recipe everywhere:
  `DOTCLAUDE_LAUNCHER=1 headroom wrap claude --no-mcp --code-memory none --
  --system-prompt-file ~/.claude/dotclaude/system-prompt.md`. It starts the
  proxy, keeps the dotclaude system prompt, and stops the proxy when the
  session ends. The README and the session-start notice told you to start
  `headroom proxy` by hand, which nothing stopped, while the setup skill said
  `headroom wrap claude`. `headroom unwrap claude --keep-mcp` stops a proxy
  that stays after a crash.
- A code comment said that a hook's "ask" lets the user approve any write to
  Claude settings in auto mode. That is true for Bash commands only. For Edit
  or Write on a settings file, Claude Code keeps its classifier in the
  pipeline, and a classifier deny stands. No hook can turn that deny into a
  prompt. To make such an edit in auto mode, state the change in your message
  and retry, approve it in `/permissions` under recently denied, or make the
  edit yourself.

## [0.8.2] - 2026-09-28

### Added

- The Bash guard denies recursive searches and listings that would walk
  gitignored directories such as build output, dependencies, and caches. An
  agent's `grep -r` in a repository with an 8.9 GB `.build/` directory hung
  and would have flooded the context with generated files. The guard covers
  `grep -r`, `find`, `tree`, `ls -R`, `ack`, `rg` and `ag` with
  ignore-bypass flags (`--no-ignore`, `-u`), `fd -I`/`-u`, and `git grep
  --no-index`. It asks `git` which ignored directories are under the search
  path, so a walk passes when it has none, when it starts inside an ignored
  directory, when it excludes each one (`--exclude-dir`, `-prune`, `-g '!…'`,
  `-E`, `tree -I`, including `{a,b}` lists), or when it is at most two levels
  deep. The deny message names the directories and points to `rg`, `fd`, or
  `git grep`, which skip ignored files. It follows the `bash_guard` option.
- The settings profile sets `CLAUDE_CODE_GLOB_NO_IGNORE` to `"false"`, so the
  Glob tool skips gitignored files as the Grep tool already does. Claude Code
  2.1.283 runs Glob as `rg --files --no-ignore` unless this variable is false;
  in a test repository, `**/*.swift` returned files under `.build/` and
  `node_modules/` without it and only the tracked file with it. The variable
  comes from the Claude Code source and is not documented, so a later release
  may change it. Run `apply-settings` again to add it.
- `AGENTS.md` gives coding agents the repository's commands and rules.
  `CLAUDE.md` and `GEMINI.md` are symlinks to it.

### Changed

- `docs/dossier.md` replaces the five research docs. It is an index to six
  parts under `docs/dossier/` that hold the design decisions and the
  measurements behind them. The README is about half as long.
- Releases before 0.8.0 moved from this file to `docs/changelog/`. Each
  Markdown file now has 300 lines or less.

## [0.8.1] - 2026-09-28

### Added

- Writes to Claude Code's own configuration ask the user. In auto mode, the
  classifier denied them as self-modification even when the user asked for
  them, so the 0.8.0 migration could not finish. A hook "ask" skips the
  classifier and shows a permission prompt (checked in Claude Code
  2.1.283). The Bash guard asks for this skill's `apply-settings`,
  `apply-claude-md`, `apply-launcher`, and `install-managed` scripts with
  `--apply`, and for commands that write a `.claude/settings*.json` or
  `managed-settings` file. It follows the `bash_guard` option. The edit
  guard, which already asked for settings edits, now also covers
  `managed-settings.d/*.json`.
- `install-managed` can run from Claude Code. `scripts/askpass.sh` asks for
  the admin password in a desktop dialog (`osascript` on macOS; `zenity`,
  `kdialog`, or `ssh-askpass` on Linux) through `sudo -A`, after the Bash
  guard's prompt. Without a dialog, the user runs the command in a terminal
  as before.

### Changed

- `apply-settings` removes exact entries that older dotclaude profiles wrote
  and 0.8 dropped: the `AskUserQuestion` deny, the two Codex allow rules,
  and `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-5-5`. The preview lists
  each one. The same keys with other values stay.
- The settings profile sets `CLAUDE_CODE_FORK_SUBAGENT` to `"0"` instead of
  `"false"`. Claude Code reads both as off, and the settings JSON schema
  accepts only `"0"` and `"1"`.
- When a session starts without the `claude` function but the startup file
  already has it, the session-start notice says so and names
  `source <file>` or a new terminal as the fix. This happens when the
  terminal was opened before the launcher was installed.

### Fixed

- A `/dotclaude:` skill name inside a fenced code block no longer counts as
  an invocation. A pasted session-start notice in a code fence made Claude
  ask the user to send `/dotclaude:apply-settings-profile` again.

## [0.8.0] - 2026-09-28

### Added

- Session start checks instruction files. It warns when one file passes 150
  lines and reports a failure when it passes 200. The check covers every
  `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, and `.claude/rules/` file and
  every file they `@import`, without block-level HTML comments. The text that
  loads at session start gets a warning above about 3,000 tokens and a
  failure above 5,000. A file above 4 MiB, an import more than four hops deep,
  and an `AGENTS.md` that a `CLAUDE.md` hides without `@AGENTS.md` are also
  reported. Names symlinked to one file (`CLAUDE.md`, `AGENTS.md`,
  `GEMINI.md`) are checked once, under the original's path. A symlink to a
  missing file gets its own warning.
- The `git_attribution` option, on by default. The settings profile's
  `includeGitInstructions: false` makes Claude Code drop its `Co-Authored-By`
  commit trailer and pull request footer. The session notes now give them
  back, and Claude Code's `attribution` setting still changes or removes them.
- A replacement for Claude Code's built-in system prompt. It holds
  dotclaude's engineering and git rules and names the installed Claude Code
  version. The output style keeps only how Claude talks and reports, and
  shrinks from about 15 KB to about 2.3 KB. Only a CLI flag
  can replace that prompt, so `/dotclaude:apply-settings-profile` now installs
  a `claude` shell function that passes `--system-prompt-file`. It supports
  zsh, bash, fish, and PowerShell on macOS, Linux, and Windows. The function
  adds nothing when you pass your own system prompt flag or set
  `DOTCLAUDE_SYSTEM_PROMPT=0`. Session start keeps its prompt copy up to date
  after plugin and Claude Code updates.
- Session start tells you when a session runs without the dotclaude system
  prompt: the launcher is not installed, or an IDE or another program started
  Claude Code without the shell function. Such a session has only the output
  style's rules. When `ANTHROPIC_BASE_URL` is set, the notice explains how to
  run a proxy such as Headroom with the function: `headroom proxy` and an
  exported `ANTHROPIC_BASE_URL`, not `headroom wrap claude`. Set
  `DOTCLAUDE_SYSTEM_PROMPT=0` to run without the prompt and without the notice.
  After you update, run `/dotclaude:apply-settings-profile` again to install or
  refresh the launcher.
- `docs/claude-code-prompt-surface.md` records the text of the lean prompt
  that `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` selects, and the conditions for each
  part.
- `docs/letter-to-skills-developer.txt` lists dossier gaps that belong in
  xsyetopz/skills skills. `docs/letter-to-skills-developer-skill-lint.txt`
  gives that repository a skill lint gate and the fixes it needs first.

### Changed

- The output style, the agents, the skills, the plugin option descriptions,
  and the hook messages Claude reads follow Simplified Technical English
  (ASD-STE100) and Anthropic's current prompting guides: no semicolons, short
  sentences, active voice with a named actor, no phrasal verbs or metaphor,
  one word per action, and a reason kept with each rule. No rule changed
  meaning.
- dotclaude's tests check its own files against token and line limits in
  place of the 21.5 KB byte cap: the output style warns above 1,000 tokens
  and fails above 2,000, the system prompt 5,000 and 15,000, each agent body
  2,000 and 5,000, and each `SKILL.md` 450 and 500 lines and 4,500 and 5,000
  body tokens. Skill names and descriptions stay inside the Agent Skills
  limits of 64 and 1,024 characters.
- New rules from the dossier reports, now in the system prompt: apply a
  correction to every similar case, make sure the edited file is the file that
  runs, count a bug test only after it fails without the fix, a mock of the
  part under test cannot catch its defect, review the whole task's diff, do
  not remove a feature to pass a test, repeat a search or fix only when you
  expect new evidence, open a search hit before you rely on it, revisit an
  earlier decision that proved wrong, do not turn prose guidance into tests or
  rule files, and wait for background jobs with `Monitor`. A priority order
  settles conflicts between rules.
- Eval prompts mention files as bare `@file`, which Claude Code expands.
  The earlier `` @`file` `` form did not expand.

### Fixed

- The subagent test for forks no longer fails when the shell running it sets
  `CLAUDE_CODE_FORK_SUBAGENT=false`.

## Older Releases

| Series | Releases |
| --- | --- |
| [0.7](docs/changelog/0.7.md) | 0.7.0 |
| [0.6](docs/changelog/0.6.md) | 0.6.2, 0.6.1, 0.6.0 |
| [0.5](docs/changelog/0.5.md) | 0.5.1, 0.5.0 |
| [0.4](docs/changelog/0.4.md) | 0.4.0 |
| [0.3](docs/changelog/0.3.md) | 0.3.0 |
| [0.1 and 0.2](docs/changelog/0.1-0.2.md) | 0.2.0, 0.1.0 |

[unreleased]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.8.1...HEAD
[0.8.2]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.8.1...dotclaude--v0.8.2
[0.8.1]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.8.0...dotclaude--v0.8.1
[0.8.0]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.7.0...dotclaude--v0.8.0
