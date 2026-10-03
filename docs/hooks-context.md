# Context Hooks

Part of the [hooks](hooks.md) page of the [dotclaude documentation](README.md).
These hooks give Claude facts that it would not have otherwise.

## Working Rules

**What:** at startup, after `/clear`, and after each compaction, adds the
[working rules](working-rules.md) from `hooks/session-start/working-rules.md`.
It adds nothing on `--resume`, on a fork, or in a subagent.

**Why:** hook context arrives in the same role-`system` message as an output
style, so the rules apply with every style, and each style holds only its
reply style. The rules have their own command in `hooks.json`, because Claude
Code keeps at most about 10,000 bytes of output per hook command. A resumed
transcript already holds the rules, so a new copy would be a duplicate. See
[prompt surface](dossier/prompt-surface.md#output-styles-and-hook-context).

## Nested Instructions (`context_nested_instructions`)

**What:** when a Bash command such as `cat`, `sed`, or `rg` reads files in a
directory, adds that directory's `CLAUDE.md`, `.claude/CLAUDE.md`, and
`CLAUDE.local.md` once per session.

**Why:** Claude Code loads a subdirectory's `CLAUDE.md` only when the Read
tool opens a file there
([#90450](https://github.com/anthropics/claude-code/issues/90450)). The
working rules let Claude read with Bash, so without this hook it would miss
the rules of the directory it works in. Path-scoped rules in `.claude/rules`
are not covered yet ([open items](dossier/open-items.md)).

## Session Files (`context_session_files`)

**What:** when an agent creates a handoff note (`.claude/handoffs/`),
`.dotclaude/` loop state, `CLAUDE.local.md`, `.claude/settings.local.json`,
or `.claude/worktrees/`, adds the path to `.git/info/exclude`.

**Why:** these files describe one session or one user, and the Claude Code
docs say not to commit the last three. `.git/info/exclude` keeps them out of
commits with no change to the tracked `.gitignore`. OpenSpec (`openspec/`)
and Spec Kit (`.specify/`) tell you to commit their files, so the hook does
not touch them.

## Compaction Carry-Over (`context_compact_carryover`)

**What:** after compaction, restores your last messages word for word, the
last check result, and the files this session edited.
Before compaction, it adds instructions to the summary request:
keep your requests and constraints in your own words,
the decisions and the rejected approaches with their reasons,
the current state and the open items,
and exact paths, commands, errors, and numbers.
After four compactions of the main session, the summary also starts from the latest handoff note under `.claude/handoffs/` and gives its path.

**Why:** a compaction summary paraphrases. Your exact words, the last test
result, and the list of edited files are the facts that the next turn acts
on, so the hook restores them unchanged. A subagent compaction keeps and
restores nothing, so it cannot replace the main session's messages.
From 2026-09-30 to 2026-10-03, each compaction kept 45% to 59% of the facts that the next part of the session used.

The note has a bound of 2500 characters.
Each file list stops at 400 characters and gives the count of the other files,
so long paths cannot push out your messages or the instructions.
When your messages do not fit, the newest message goes in first, because it
holds the current request.
The oldest messages drop first.
A long message that is cut keeps its start and its end, because a message
often ends with its request.
Then the note gives the path of the transcript, so that Claude can read the
full text only when it needs it.

## Edit-Miss Lines

**What:** when an `Edit` fails because `old_string` matches no text, gives
Claude the closest lines of the file with their line numbers.

**Why:** without them, Claude often guesses the text again or reads the
whole file again. The idea comes from DensePack `edit_gate.py` (MIT).

## Handoff Pointer (`context_handoff_pointer`)

**What:** at startup and after `/clear`, when `.claude/handoffs/` holds a
note with status `in-progress` or `blocked`, tells Claude the path of the
newest one, its branch and commit, and the count of older open notes. Claude
reads the note when you ask to continue, and checks it against `git status`
and `git log` first.

**Why:** a new session does not know that a handoff note exists. The pointer
costs one line, and the note loads only when the work needs it. Notes with
status `done` or `superseded` get no pointer, so finished work does not
mislead the next session.

## Cold Cache On Resume

**What:** when you resume or fork a session with 100k tokens of context or
more, and its prompt cache has expired, tells you the size of the context and
the estimated cost to write it to the cache again.

**Why:** the first prompt of such a session writes the whole context to the
cache at 1.25x or 2x the input price. The status line shows this only after
that prompt. A `/clear` and a handoff note avoid the cost.

## Instruction-File Lint

**What:** at session start, reports `CLAUDE.md`, `AGENTS.md`, and rule files
that pass 150 lines (warning) or 200 lines (failure). It also reports
startup instructions above about 3,000 tokens together, and broken imports or
symlinks.

**Why:** Claude Code targets 200 lines for an instruction file, and it skips
a file above 4 MB. Startup instructions load into every request. The numbers
are in `hooks/lib/_budget.mjs`.

## Line Breaks (`context_line_breaks`)

**What:** after an edit, tells Claude when the text that it wrote breaks lines at a column width.
The rule is semantic line breaks: each sentence starts on a new line,
and a long sentence breaks only between clauses.
When [`semlf`](https://pypi.org/project/semlf/) is on `PATH`,
the hook runs `semlf --hook claude` and gives its report to Claude.
Otherwise a built-in check finds prose lines of 60 characters or more that stop inside a clause.
Both ways, the hook finds a word split between two comment lines, such as `configur` and `ation`.
`semlf` 1.0.1 does not find a split word.
A PostToolUse hook cannot stop an edit, so each finding is a note.
The option is off by default, because the line-break style is a project convention, not a default for every repository.
Turn it on with `/plugin`, or with `echo '{"context_line_breaks": "true"}' | claude plugin configure dotclaude@dotclaude --values-stdin`.
The hook skips `tmp/`, `vendor/`, `node_modules/`, `dist/`, `build/`, `testdata/`, and `fixtures/`,
as `semlf` does.

**Why:** Claude writes hard line breaks at about 80 columns, whatever the terminal width
([#33666](https://github.com/anthropics/claude-code/issues/33666)).
Hard-wrapped instruction files can make the model wrap its own output the same way
([openchamber#4257](https://github.com/openchamber/openchamber/issues/4257)).
Semantic line breaks keep each diff to the sentences that changed,
and they do not depend on a column width.
A note after each edit holds better than a rule in the prompt only.
Install `semlf` with `uv tool install semlf`, or run `/dotclaude:setup integrations semlf`.
If you also install the `semlf` plugin for Claude Code, turn off one of the two checks.
