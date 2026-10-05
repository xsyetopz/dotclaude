# Release 0.8

Release 0.8 moved the engineering and git rules from the output style into a replacement system prompt.
Release 0.8.0 (2026-09-28) added the replacement prompt, the launcher function, and checks of instruction files.
Release 0.8.1 (2026-09-28) let the user approve writes to Claude Code settings in auto mode.
Release 0.8.2 (2026-09-28) stopped agents from searching gitignored directories.
After you update to 0.8.0, run `/dotclaude:apply-settings-profile` again to install or refresh the launcher.

## Added

- A replacement for the built-in system prompt of Claude Code (0.8.0).
  It holds dotclaude's engineering and git rules and names the installed Claude Code version.
  The output style keeps only how Claude talks and reports, and shrinks from about 15 KB to about 2.3 KB.
  - Only a CLI flag can replace that prompt.
    `/dotclaude:apply-settings-profile` installs a `claude` shell function that passes `--system-prompt-file`.
    It supports zsh, bash, fish, and PowerShell on macOS, Linux, and Windows.
  - The function adds nothing when you pass your own system prompt flag or set `DOTCLAUDE_SYSTEM_PROMPT=0`.
  - Session start keeps its prompt copy current after plugin and Claude Code updates.
- Session start tells you when a session runs without the dotclaude system prompt (0.8.0).
  The launcher may be missing, or an IDE or another program may have started Claude Code without the shell function.
  Such a session has only the rules of the output style.
  - When `ANTHROPIC_BASE_URL` is set, the notice explains how to run a proxy such as Headroom with the function.
    Use `headroom proxy` and an exported `ANTHROPIC_BASE_URL`, not `headroom wrap claude`.
  - Set `DOTCLAUDE_SYSTEM_PROMPT=0` to run without the prompt and without the notice.
  - 0.8.1: when a session starts without the `claude` function but the startup file already has it, the notice says so.
    It names `source <file>` or a new terminal as the fix.
    This happens when the terminal opened before the launcher was installed.
- Session start checks instruction files (0.8.0).
  - It warns when one file passes 150 lines and reports a failure when it passes 200.
  - The check covers every `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, and `.claude/rules/` file, and every file that they `@import`, without block-level HTML comments.
  - The text that loads at session start gets a warning above about 3,000 tokens and a failure above 5,000.
  - It also reports a file above 4 MiB, an import more than four hops deep, and an `AGENTS.md` that a `CLAUDE.md` hides without `@AGENTS.md`.
  - It checks names that link to one file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) once, under the path of the original.
    A symlink to a missing file gets its own warning.
- The `git_attribution` option, on by default (0.8.0).
  The `includeGitInstructions: false` setting of the profile makes Claude Code drop its `Co-Authored-By` commit trailer and pull request footer.
  The session notes now give them back.
  The `attribution` setting of Claude Code still changes or removes them.
- Writes to the own configuration of Claude Code ask the user (0.8.1).
  In auto mode, the classifier denied them as self-modification even when the user asked for them, so the 0.8.0 migration could not finish.
  A hook "ask" skips the classifier and shows a permission prompt (checked in Claude Code 2.1.283).
  - The Bash guard asks for the `apply-settings`, `apply-claude-md`, `apply-launcher`, and `install-managed` scripts of this skill with `--apply`.
    It also asks for commands that write a `.claude/settings*.json` or `managed-settings` file.
    It follows the `bash_guard` option.
  - The edit guard already asked for settings edits.
    It now also covers `managed-settings.d/*.json`.
- `install-managed` can run from Claude Code (0.8.1).
  `scripts/askpass.sh` asks for the admin password in a desktop dialog through `sudo -A`, after the prompt of the Bash guard.
  It uses `osascript` on macOS, and `zenity`, `kdialog`, or `ssh-askpass` on Linux.
  Without a dialog, the user runs the command in a terminal as before.
- The Bash guard denies recursive searches and listings that would walk gitignored directories, such as build output, dependencies, and caches (0.8.2).
  An agent's `grep -r` in a repository with an 8.9 GB `.build/` directory hung, and it would have flooded the context with generated files.
  - The guard covers `grep -r`, `find`, `tree`, `ls -R`, `ack`, `rg` and `ag` with ignore-bypass flags (`--no-ignore`, `-u`), `fd -I` and `-u`, and `git grep --no-index`.
  - It asks `git` which ignored directories are under the search path.
    A walk passes when there are none, when it starts inside an ignored directory, or when it is at most two levels deep.
    A walk also passes when it excludes each ignored directory (`--exclude-dir`, `-prune`, `-g '!…'`, `-E`, `tree -I`, including `{a,b}` lists).
  - The deny message names the directories and points to `rg`, `fd`, or `git grep`, which skip ignored files.
  - It follows the `bash_guard` option.
- The settings profile sets `CLAUDE_CODE_GLOB_NO_IGNORE` to `"false"`, so the Glob tool skips gitignored files as the Grep tool already does (0.8.2).
  Claude Code 2.1.283 runs Glob as `rg --files --no-ignore` unless this variable is false.
  In a test repository, `**/*.swift` returned files under `.build/` and `node_modules/` without it, and only the tracked file with it.
  The variable comes from the Claude Code source and has no documentation, so a later release may change it.
  Run `apply-settings` again to add it.
- `AGENTS.md` gives coding agents the commands and rules of the repository (0.8.2).
  `CLAUDE.md` and `GEMINI.md` are symlinks to it.
- `docs/claude-code-prompt-surface.md`, now part of [Prompt surface](Prompt-Surface), records the text of the lean prompt that `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` selects, and the conditions for each part (0.8.0).
  See [Prompt-Surface](Prompt-Surface).
- Two letters that list gaps for xsyetopz/skills (0.8.0):
  - `docs/letter-to-skills-developer.txt`, a local file of the maintainer that was never in the repository, lists dossier gaps that belong in skills.
  - `docs/letter-to-skills-developer-skill-lint.txt`, also a local file, gives that repository a skill lint gate and the fixes that it needs first.

## Changed

- The output style, the agents, the skills, the option descriptions, and the hook messages that Claude reads follow ASD-STE100 (0.8.0).
  They also follow the current prompting guides of Anthropic.
  They use no semicolons, short sentences, and active voice with a named actor.
  They use no phrasal verbs or metaphor, one word per action, and a reason with each rule.
  No rule changed meaning.
- dotclaude's tests check its own files against token and line limits.
  They replace the 21.5 KB byte cap (0.8.0):

  | File | Warning | Failure |
  | --- | --- | --- |
  | Output style | 1,000 tokens | 2,000 tokens |
  | System prompt | 5,000 tokens | 15,000 tokens |
  | Each agent body | 2,000 tokens | 5,000 tokens |
  | Each `SKILL.md` | 450 lines, 4,500 body tokens | 500 lines, 5,000 body tokens |

  Skill names and descriptions stay inside the Agent Skills limits of 64 and 1,024 characters.
- New rules from the dossier reports, now in the system prompt (0.8.0):
  - apply a correction to every similar case
  - make sure that the edited file is the file that runs
  - count a bug test only after it fails without the fix
  - a mock of the part under test cannot catch its defect
  - review the diff of the whole task
  - do not remove a feature to pass a test
  - repeat a search or fix only when you expect new evidence
  - open a search hit before you rely on it
  - revisit an earlier decision that proved wrong
  - do not turn prose guidance into tests or rule files
  - wait for background jobs with `Monitor`

  A priority order settles conflicts between rules.
- Eval prompts mention files as bare `@file`, which Claude Code expands (0.8.0).
  The earlier `` @`file` `` form did not expand.
- `apply-settings` removes exact entries that older dotclaude profiles wrote and 0.8 dropped (0.8.1).
  These are the `AskUserQuestion` deny, the two Codex allow rules, and `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-5-5`.
  The preview lists each one.
  The same keys with other values stay.
- The settings profile sets `CLAUDE_CODE_FORK_SUBAGENT` to `"0"` instead of `"false"` (0.8.1).
  Claude Code reads both as off, and the settings JSON schema accepts only `"0"` and `"1"`.
- `docs/dossier.md` replaces the five research docs (0.8.2).
  It is an index to six parts under `docs/dossier/` that hold the design decisions and the measurements behind them.
  The dossier is now the evidence pages of this wiki, from [Design](Design) to [Open items](Open-Items).
  See [Design](Design).
  The README is about half as long.
- Releases before 0.8.0 moved from the changelog to `docs/changelog/` (0.8.2).
  They are now the [Release history](Release-History) pages.
  Each Markdown file now has 300 lines or less.

## Fixed

- The subagent test for forks no longer fails when the shell that runs it sets `CLAUDE_CODE_FORK_SUBAGENT=false` (0.8.0).
- A `/dotclaude:` skill name inside a fenced code block no longer counts as an invocation (0.8.1).
  A pasted session-start notice in a code fence made Claude ask the user to send `/dotclaude:apply-settings-profile` again.

Previous: [Release 0.7](Release-0.7) · Next: [Release 0.9](Release-0.9)
