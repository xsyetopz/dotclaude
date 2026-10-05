# Release 0.8

Released 2026-09-28, in three patches: 0.8.0, 0.8.1, and 0.8.2.
Moves the engineering and git rules from the output style into a replacement system prompt.
A version in parentheses marks a patch, and each patch is dated 2026-09-28.

| Version | Change |
| --- | --- |
| 0.8.0 | Replacement prompt, launcher function, instruction-file checks |
| 0.8.1 | Writes to Claude Code settings ask the user in auto mode |
| 0.8.2 | Agents stop searching gitignored directories |

> **Note:** After you update to 0.8.0, run `/dotclaude:apply-settings-profile` again to install or refresh the launcher.

## Added

- Replacement system prompt (0.8.0): replaces the built-in prompt of Claude Code.
  It holds the engineering and git rules and names the installed Claude Code version.
  The output style keeps only how Claude talks and reports, and shrinks from about 15 KB to about 2.3 KB.
  - Only a CLI flag can replace that prompt.
    `/dotclaude:apply-settings-profile` installs a `claude` shell function that passes `--system-prompt-file`.
    It supports zsh, bash, fish, and PowerShell on macOS, Linux, and Windows.
  - The function adds nothing when you pass your own system prompt flag or set `DOTCLAUDE_SYSTEM_PROMPT=0`.
  - Session start keeps its prompt copy current after plugin and Claude Code updates.
- Missing-prompt notice (0.8.0): session start tells you when a session runs without the dotclaude system prompt.
  The launcher may be missing, or an IDE or another program may have started Claude Code without the shell function.
  Such a session has only the rules of the output style.
  - With `ANTHROPIC_BASE_URL` set, the notice explains how to run a proxy such as Headroom with the function.
    Use `headroom proxy` and an exported `ANTHROPIC_BASE_URL`, not `headroom wrap claude`.
  - Set `DOTCLAUDE_SYSTEM_PROMPT=0` to run without the prompt and without the notice.
  - 0.8.1: when a session starts without the `claude` function but the startup file already has it, the notice names `source <file>` or a new terminal as the fix.
    This happens when the terminal opened before the launcher was installed.
- Instruction-file checks (0.8.0): session start checks every `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, and `.claude/rules/` file, and every file that they `@import`, without block-level HTML comments.
  - One file warns above 150 lines and fails above 200.
  - The text that loads at session start warns above about 3,000 tokens and fails above 5,000.
  - It also reports a file above 4 MiB, an import more than four hops deep, and an `AGENTS.md` that a `CLAUDE.md` hides without `@AGENTS.md`.
  - Names that link to one file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) count once, under the path of the original.
    A symlink to a missing file gets its own warning.
- `git_attribution` option (0.8.0, on by default): the `includeGitInstructions: false` setting of the profile makes Claude Code drop its `Co-Authored-By` commit trailer and pull request footer.
  The session notes now give them back.
  The `attribution` setting of Claude Code still changes or removes them.
- Ask on settings writes (0.8.1): writes to the own configuration of Claude Code ask the user.
  In auto mode, the classifier denied them as self-modification even when the user asked, so the 0.8.0 migration could not finish.
  A hook "ask" skips the classifier and shows a permission prompt (checked in Claude Code 2.1.283).
  - The Bash guard asks for the `apply-settings`, `apply-claude-md`, `apply-launcher`, and `install-managed` scripts of this skill with `--apply`.
    It also asks for commands that write a `.claude/settings*.json` or `managed-settings` file, and it follows the `bash_guard` option.
  - The edit guard already asked for settings edits, and it now also covers `managed-settings.d/*.json`.
- `install-managed` from Claude Code (0.8.1): `scripts/askpass.sh` asks for the admin password in a desktop dialog through `sudo -A`, after the prompt of the Bash guard.
  It uses `osascript` on macOS, and `zenity`, `kdialog`, or `ssh-askpass` on Linux.
  Without a dialog, the user runs the command in a terminal as before.
- Ignored-directory guard (0.8.2): the Bash guard denies recursive searches and listings that would walk gitignored directories, such as build output, dependencies, and caches.
  An agent's `grep -r` in a repository with an 8.9 GB `.build/` directory hung, and it would have flooded the context with generated files.
  - It covers `grep -r`, `find`, `tree`, `ls -R`, `ack`, `rg` and `ag` with ignore-bypass flags (`--no-ignore`, `-u`), `fd -I` and `-u`, and `git grep --no-index`.
  - It asks `git` which ignored directories are under the search path.
    A walk passes when there are none, when it starts inside an ignored directory, or when it is at most two levels deep.
    A walk also passes when it excludes each ignored directory (`--exclude-dir`, `-prune`, `-g '!…'`, `-E`, `tree -I`, including `{a,b}` lists).
  - The deny message names the directories and points to `rg`, `fd`, or `git grep`, which skip ignored files.
  - It follows the `bash_guard` option.
- `CLAUDE_CODE_GLOB_NO_IGNORE` (0.8.2): the settings profile sets it to `"false"`, so the Glob tool skips gitignored files as the Grep tool already does.
  Claude Code 2.1.283 runs Glob as `rg --files --no-ignore` unless this variable is false.
  In a test repository, `**/*.swift` returned files under `.build/` and `node_modules/` without it, and only the tracked file with it.
  The variable comes from the Claude Code source and has no documentation, so a later release may change it.
  Run `apply-settings` again to add it.
- `AGENTS.md` (0.8.2): gives coding agents the commands and rules of the repository.
  `CLAUDE.md` and `GEMINI.md` are symlinks to it.
- Prompt surface doc (0.8.0): `docs/claude-code-prompt-surface.md`, now part of [Prompt surface](Prompt-Surface), records the text of the lean prompt that `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` selects, and the conditions for each part.
- Two letters that list gaps for xsyetopz/skills (0.8.0), both local files of the maintainer that were never in the repository:
  - `docs/letter-to-skills-developer.txt` lists dossier gaps that belong in skills.
  - `docs/letter-to-skills-developer-skill-lint.txt` gives that repository a skill lint gate and the fixes that it needs first.

## Changed

- ASD-STE100 (0.8.0): the output style, the agents, the skills, the option descriptions, and the hook messages that Claude reads follow ASD-STE100 and the current prompting guides of Anthropic.
  They use no semicolons, short sentences, and active voice with a named actor.
  They use no phrasal verbs or metaphor, one word per action, and a reason with each rule.
  No rule changed meaning.
- Size tests (0.8.0): dotclaude's tests check its own files against token and line limits.
  They replace the 21.5 KB byte cap.

  | File | Warning | Failure |
  | --- | --- | --- |
  | Output style | 1,000 tokens | 2,000 tokens |
  | System prompt | 5,000 tokens | 15,000 tokens |
  | Each agent body | 2,000 tokens | 5,000 tokens |
  | Each `SKILL.md` | 450 lines, 4,500 body tokens | 500 lines, 5,000 body tokens |

  Skill names and descriptions stay inside the Agent Skills limits of 64 and 1,024 characters.
- New system-prompt rules from the dossier reports (0.8.0):
  - Apply a correction to every similar case.
  - Make sure that the edited file is the file that runs.
  - Count a bug test only after it fails without the fix.
  - A mock of the part under test cannot catch its defect.
  - Review the diff of the whole task.
  - Do not remove a feature to pass a test.
  - Repeat a search or fix only when you expect new evidence.
  - Open a search hit before you rely on it.
  - Revisit an earlier decision that proved wrong.
  - Do not turn prose guidance into tests or rule files.
  - Wait for background jobs with `Monitor`.
  - A priority order settles conflicts between rules.
- Eval prompts (0.8.0): mention files as bare `@file`, which Claude Code expands.
  The earlier `` @`file` `` form did not expand.
- `apply-settings` cleanup (0.8.1): removes exact entries that older dotclaude profiles wrote and 0.8 dropped.
  These are the `AskUserQuestion` deny, the two Codex allow rules, and `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-5-5`.
  The preview lists each one, and the same keys with other values stay.
- `CLAUDE_CODE_FORK_SUBAGENT` (0.8.1): the settings profile sets `"0"` instead of `"false"`.
  Claude Code reads both as off, and the settings JSON schema accepts only `"0"` and `"1"`.
- Dossier (0.8.2): `docs/dossier.md` replaces the five research docs.
  It indexes six parts under `docs/dossier/` that hold the design decisions and the measurements behind them.
  The dossier is now the evidence pages of this wiki, from [Design](Design) to [Open items](Open-Items).
  The README is about half as long.
- Old releases (0.8.2): releases before 0.8.0 moved from the changelog to `docs/changelog/`.
  They are now the [Release history](Release-History) pages.
  Each Markdown file now has 300 lines or less.

## Fixed

- Fork test (0.8.0): the subagent test for forks no longer fails when the shell that runs it sets `CLAUDE_CODE_FORK_SUBAGENT=false`.
- Skill names in code fences (0.8.1): a `/dotclaude:` skill name inside a fenced code block no longer counts as an invocation.
  A pasted session-start notice in a code fence made Claude ask the user to send `/dotclaude:apply-settings-profile` again.

Previous: [Release 0.7](Release-0.7) · Next: [Release 0.9](Release-0.9)
