# Release 0.16

Release 0.16 reworked the handoff notes.
Each note now has its own file with front matter, and a new hook points a new session to the newest open note.
The release also fixed many false asks and false denies in the guards.
A version in parentheses marks a change from a later patch of this line.
An entry with no version comes from 0.16.0.

## Added

- The `exclude_session_files` hook (on by default) adds files that describe one session or one user to `.git/info/exclude` when an agent creates them.
  The files are the handoff note, `.dotclaude/`, `CLAUDE.local.md`, `.claude/settings.local.json`, and `.claude/worktrees/`.
  Before, the handoff skill only told the user to add the note to `.gitignore`.
  Files that their tools say to commit, such as `openspec/`, stay tracked.
- The `handoff_pointer` hook (on by default) tells a new session, at startup and after `/clear`, where the newest open handoff note is.
  Claude reads the note only when the user asks to continue, and checks it against `git status` and `git log` first.
- A handoff note starts with front matter: `status` (`in-progress`, `blocked`, `done`, or `superseded`), `branch`, `head`, and `written`.
  The **Goal** section ends with a **Done when** line, and **State** marks partial work.
  **Open** lists the questions for the user and the promises made to the user.
  These follow the common handoff templates: a status field that tools can read, a definition of done, and a flag on unfinished work.
- `/dotclaude:setup-integrations openspec` installs the OpenSpec CLI and runs `openspec init --tools claude` in the project that the user names.
  The status script reports the CLI, `openspec/config.yaml`, and the `openspec-*` skills.

## Changed

- **Breaking:** `write-session-handoff` writes a new note to `.claude/handoffs/<YYYY-MM-DD-HHMM>-<topic>.md` (UTC time), not to `.claude/handoff.md`, and keeps the earlier notes.
  A newer note for the same work sets the earlier one to `superseded`.
  dotclaude does not read `.claude/handoff.md` anymore.
  To continue from an old note, move it into `.claude/handoffs/`, or give its path to Claude.
- A subagent gets one note when its context comes within 15k tokens of its budget.
  The note says to finish the current item, remove the scratch files, and report.
  Past the budget, the agent can still remove its own files in the temp folder.
  Before, audit agents stopped in the middle of an item and left their scratch files.
- The stop checks send Claude back with `additionalContext`, so Claude Code shows them as "Stop hook feedback", not as "Stop hook error".
- Skills that take `$ARGUMENTS` put their `<task>` last, after the reference sections, as the prompt guidance of Anthropic orders data before the query.
- The `integration-setup` agent gets the reason for each of its limits.
  It does not state a training cutoff that a model override makes wrong.
- The output style lists apology with the other replies that tell the user nothing.
- Main-conversation audits fix each finding that an MRE proves before the report.
  The output style does not put a proven bug in the follow-ups.
- The same change to many like files, for example each locale file, is one slice for one agent.
  Before, one session started an agent for each locale.
- The context note and the system prompt give the compaction point as about 117k tokens, not "before 150k".

## Fixed

- With the settings profile `includeGitInstructions: false`, Claude still runs a `verify` or `simplify` skill before each commit (0.16.1).
  Claude Code 2.1.286 gives this instruction in its git instructions when a user or project skill has one of these names.
  Docs-only and tests-only commits are the exception.
  With `includeCodeReviewSuggestion: true`, it also names `/code-review medium`.
  The profile turns those instructions off, so the session notes give the same instruction.
- A permission prompt no longer starts with `[dotclaude]`, because Claude Code already labels the prompt as a hook prompt.
  An allow reason also has no tag, because only the user sees it.
  Messages to Claude keep the tag.
  The foreground rewrite of an `Agent` call shows no reason, because it showed on every spawn.
- The stop and compaction messages quote only the check command, not the whole Bash command around it.
  Before, a check inside a heredoc script showed the script, cut at 200 characters in the middle of a code span.
- The compaction summary no longer counts as a user prompt.
  Before, the destructive-command and risky-edit guards could read the summary as the last message of the user, and the prompts kept after compaction included it.
- A check counts when it runs through `xcrun` (`xcrun swift test`, `xcrun xcodebuild ... test`), with several recipes (`just skills skill-lint markdown`), with flags before the recipe (`make -C app test`), or as `just validate`.
- The open-task check stops Claude again only for a task that it did not report before.
  Before, closing one of the reported tasks made the rest block again.
- A `/dotclaude:` skill named in the middle of a message runs at the step where the message puts it.
  Before, the hook said to run it now, also for "commit this, then `/dotclaude:write-session-handoff`".
- The Bash guard no longer asks for these commands:
  - A heredoc script that names `settings.json` only as data, or that has `fs.rmSync` inside a JavaScript template string.
  - `find -name __pycache__ -prune -exec rm -r {} +`.
  - `rm -r` of a temp folder through a variable: a `for` loop word, an `mktemp -d` template in the temp folder, or `$TMPDIR/<name>`.
  - A command with `IFS= read`. Before, this stopped all variable expansion.

  A write to a settings file in a heredoc, or `rm -rf` of a loop word outside the temp folder, still asks.

Previous: [Release 0.15](Release-0.15) · Next: [Release 0.17](Release-0.17)
