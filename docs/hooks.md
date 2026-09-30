# Hooks

Part of the [dotclaude documentation](README.md). Each hook enforces a rule
that a program can check, because a rule stated only in prose did not hold in
the measured week ([usage evidence](dossier/usage.md)). Turn off a hook in
`/config` or with `claude plugin configure dotclaude@dotclaude`. The option
name is after each heading.

Every dotclaude message starts with `[dotclaude]`. The guards never approve
anything, and they fail open, so a bug in a guard does not stop your work.
After you approve an ask and the tool runs, the guards do not ask again in
that session for the same command or edit. Each deny and ask goes to
`verdicts.jsonl` in the plugin data directory, so you can see which rules
fire often. The guards are a best-effort parser, not a sandbox. For hard
isolation, use Claude Code's
[sandbox](https://code.claude.com/docs/en/sandboxing). To run a command that
a guard denied, type `! <command>`.

## Guards

### Bash Guard (`bash_guard`)

**What:** asks before destructive or public commands, such as force push,
`reset --hard`, publishing, `gh` writes, destructive SQL, and `curl | sh`. It
finds them inside `sudo`, `env`, `bash -c`, `eval`, `$(...)`, heredocs, and
loops. It denies deletion of `/` or your home directory.

**Why:** these actions are hard to reverse or visible to other people. A
published package, a pushed branch, or a sent comment stays public after a
delete. The decision is yours, so the guard asks.

**What:** denies recursive searches that walk gitignored build output or
dependencies (`grep -r`, `find`, `tree`, `rg --no-ignore`, `fd -I`). Plain
`rg`, `fd`, and `git grep` skip those directories. A gitignored directory
with fewer than 200 entries, such as `__pycache__`, does not cause a deny.
An explicit bypass (`rg -uu`, `fd -I`, `git grep --no-index`) is denied only
when it walks a build or dependency directory, such as `node_modules`,
`dist`, or `.build`. A bypass into ignored notes or docs passes.

**Why:** an agent's `grep -r` in a repository with an 8.9 GB `.build/`
directory hung, and it would have filled the context with generated files.
Each turn re-reads the whole context, so text that enters the context costs
usage on every later turn ([usage evidence](dossier/usage.md)).

**What:** checks commits, pushes, pull requests, issues, discussions, and
comments against a catalog of project AI policies. It denies a contribution
to a project that forbids AI work, and asks before a write to a repository
that you do not own. See [Contributions](contributions.md).

**Why:** a contribution speaks for you in public, and some projects do not
accept AI work.

**What:** denies a full `cat` or `Read` of a file that the same agent
already read in full, when the file did not change. A partial `Read` with
`offset` and `limit` passes. Compaction clears the record.

**Why:** 29% of the measured Bash file reads read a file again. The first
copy is still in the context, so the second copy only adds usage. Claude
Code already skips a `Read` after a `Read`, but not a `cat`.

**What:** denies a dev server, a watcher, or `analyzeHeadless` in the
foreground. The same command with `run_in_background` passes.

**Why:** a command that does not end blocks the turn until the Bash timeout,
and then Claude runs it again in the background.

**What:** denies a background command that reads stdin to its end before it
starts work, when the command has no stdin of its own. These commands are
`codex exec` (or `codex e`), `cat` and `python`, `python3`, or `node` with no
file, `tr`, and a shell with no script (`bash -s`). A `</dev/null` or `0<`
redirect, a heredoc, a pipe into the command, or an earlier `exec </dev/null`
lets it through. A foreground call, `--help`, and `--version` pass.

**Why:** a background call usually gets `/dev/null` as stdin. In one session
it got a pipe that did not close, for a reason that is not known. Two
`codex exec … &` runs waited on that pipe for 81 minutes, and with
`</dev/null` the same runs ended in 80 seconds. Each command in the list was
measured to wait on an open pipe. `claude -p` is not in the list, because it
goes on after 3 seconds without stdin.

**What:** denies a file follow (`tail -f`, `tail -F`, `inotifywait -m`) in
both modes, unless `timeout <seconds>` bounds it. The reason gives two
alternatives: an `until grep -q` loop in the background waits for one line,
and `Monitor` gives each new line as an event and stops after `timeout_ms`.

**Why:** a background follow runs until the session ends. It does not stop
when the line arrives or when the file is deleted. A leftover
`tail -f status.txt | grep` watched a deleted file until the user saw it.

**What:** asks before `git add` stages a file with an ELF, Mach-O, or PE
header.

**Why:** reverse engineering and builds leave binaries in the working tree.
A committed binary stays in the history after a delete.

### Edit Guard (`edit_guard`)

**What:** asks before an edit removes test assertions or skips an existing
test. It also asks before edits to Claude settings, generated files, or
lockfiles.

**Why:** a removed assertion makes a failing test pass without a fix, and it
hides the signal. An edit to Claude settings can change what Claude is
permitted to do, so you approve it. A tool writes generated files and
lockfiles, and a hand edit is lost or drifts from its source.

### Agent-Loop Oracle (`edit_guard`)

**What:** while `.dotclaude/loop/loop.json` lists `protected` globs, denies a
subagent's change to a file that matches one, and denies its removal. The
Edit and Write tools, a Bash write such as a redirect or heredoc, and `rm`,
`unlink`, `mv`, `git rm`, and `git mv` away from the file all count. The main
conversation is not limited. The globs are relative to the project root, and
a worktree agent's paths map back to that root.

**Why:** in the [agent loop](agents-and-skills.md#skills) the frozen tests are
the oracle that shows a slice is correct. An implementer that can edit the
oracle can make a failing slice pass. The deny tells the agent to make the
code pass, or to say in its report that the oracle is wrong. The user directs
the main conversation, so it can still change the oracle.

### Commit Hygiene (`commit_hygiene`)

**What:** on `git commit`, asks when the staged files include `.DS_Store`,
`.env` files, keys, build output, or a lockfile without its manifest.

**Why:** a commit is hard to take back once it is pushed, and a pushed secret
must be rotated. When the `attribution` setting leaves the Claude trailer out,
the guard also denies a commit message that still has it
([#4287](https://github.com/anthropics/claude-code/issues/4287)).

### Secret Redaction (`secret_redaction`)

**What:** runs [Betterleaks](https://github.com/betterleaks/betterleaks) on
every tool output and replaces each secret with `[REDACTED:<rule>]` before
Claude sees it. Without `betterleaks` on `PATH`, output passes through and
session start says so. gitleaks is not used. Keep it for pre-commit hooks.

**Why:** a `tail ~/.zshrc` put an API key into the context. Tool output goes
to the API and stays in the transcript. Betterleaks runs from the temp
directory with `--ignore-gitleaks-allow`, so a repository cannot turn
redaction off. Live validation stays off, so no secret leaves the machine. A
run takes about 30 ms.

### Quiet In Auto Mode (`ask_in_auto_mode`, off)

**What:** in auto mode, recoverable actions do not ask. Irreversible and
public actions still ask.

**Why:** an unattended session that waits on a prompt does no work. Auto
mode's own classifier already decides recoverable actions.

## Gates

### Verify-Before-Stop (`stop_gate`)

**What:** sends Claude back once when it edits code and stops without a test,
build, or lint run. It does the same when Claude says that tests pass after a
failure. A claim in quotes, a `>` line, or code does not count. A pass
claim with no edit and no check passes, because a read-only agent reports
results that others ran. When Claude marks a task completed after a code
edit with no check after it, the gate keeps the task open once, and names
the task. When the last paragraph of a reply announces the next step or asks
permission for work ("Should I ...?"), the gate sends Claude back once to do
the work. Public or hard-to-reverse steps pass, and so does a turn that ends
with `AskUserQuestion` or `ExitPlanMode`.

**Why:** "done" without a check that ran moves the finding of defects to you.
The working rules say this in prose, and the gate enforces it.

### Open-Task Check (`task_check`)

**What:** sends Claude back once when it ends a turn with tasks still pending
or in progress. It does not apply to subagents, or to a turn that ends with
`AskUserQuestion` or `ExitPlanMode`, because the user answers first.

**Why:** a stale task list tells you that work is open when it is done, or
done when it is open. Claude marks each task done or says why it stays open.

### Loop Reviews (`task_check`)

**What:** sends Claude back once when `.dotclaude/loop/slices.jsonl` has a
slice with `status: "implemented"`, and names the slices. Claude gives each
diff to `diff-reviewer` and sets the status to `reviewed`, or sets `failed`
with a reason. The same set of slices blocks at most once in a session. The
gate does not apply to subagents, to a turn that waits for the user, or while
a background shell or subagent runs.

**Why:** the reviewer that sees only the diff is the step that finds what the
implementer rationalized. A slice that merges without it loses that check.
One block at most lets the user pause a loop and stop.

### Stalled Goals (`goal_loop_guard`)

**What:** ends the turn and pauses a `/goal` when its check blocks a stop
twice in a row with no work between.

**Why:** in one session, Claude answered "I'm staying stopped" to 9 goal
blocks in a row. Each round re-read about 710k tokens of context and did no
work.

## Context

### Nested Instructions (`nested_instructions`)

**What:** when a Bash command such as `cat`, `sed`, or `rg` reads files in a
directory, adds that directory's `CLAUDE.md`, `.claude/CLAUDE.md`, and
`CLAUDE.local.md` once per session.

**Why:** Claude Code loads a subdirectory's `CLAUDE.md` only when the Read
tool opens a file there
([#90450](https://github.com/anthropics/claude-code/issues/90450)). The
working rules let Claude read with Bash, so without this hook it would miss
the rules of the directory it works in. Path-scoped rules in `.claude/rules`
are not covered yet ([open items](dossier/open-items.md)).

### Compaction Carry-Over (`compact_carryover`)

**What:** after compaction, restores your last messages word for word, the
last check result, and the files this session edited.

**Why:** a compaction summary paraphrases. Your exact words, the last test
result, and the list of edited files are the facts that the next turn acts
on, so the hook restores them unchanged.

### Instruction-File Lint

**What:** at session start, reports `CLAUDE.md`, `AGENTS.md`, and rule files
that pass 150 lines (warning) or 200 lines (failure). It also reports
startup instructions above about 3,000 tokens together, and broken imports or
symlinks.

**Why:** Claude Code targets 200 lines for an instruction file, and it skips
a file above 4 MB. Startup instructions load into every request. The numbers
are in `hooks/lib/_budget.mjs`.

## Usage

### Usage Bounds (`turn_limit_handoff`, `subagent_guidance`)

**What:** refuses a subagent's tool calls past 100k tokens of context (150k
for `code-reviewer`, `security-reviewer`, and `plan-reviewer`) or near its
turn limit, so its next action is its report. The work continues in a
fresh agent. Claude cannot spawn `general-purpose` agents, and subagents run
in the foreground. With 5 subagents running, Claude cannot start a sixth.

**Why:** calls with a context over 150k tokens were 74.7% of the measured
cost. `general-purpose` runs were 17.6% of it, in place of the cheaper
dotclaude agents. Claude Code delivers nothing from an agent that it stops at
its turn limit, so the agent must report first. Background agents started 501
of 861 main turns. With the bound at 150k, 34 of 69 `implementer` runs still
passed 100k, and subagent calls from 100k to 150k were 9% of the cost. The
reviewers keep 150k: a review finds defects across files only while the whole
change is in view, a fresh reviewer writes that view to the cache again, and 1
of 14 `code-reviewer` runs reached 150k. Claude Code refuses a start past
its own cap, and that caused 50 of 77 measured `Agent` errors. The guard
denies the start first and tells Claude to wait for a report. See
[enforced bounds](dossier/design.md#2-enforced-bounds)
and [usage evidence](dossier/usage.md).

### Usage Notes (`usage_notes`)

**What:** tells Claude once when the session or weekly limit passes 75% and
90%, with the reset time. At 75%, Claude writes a handoff with
`write-session-handoff` and asks you to run `/clear`. At 90%, when the work
does not fit, Claude writes a handoff and tells you the reset time. Past
100k tokens of main context, each prompt gives the context size, and in a
run with no prompt, one tool call gives it once. A terminal notification
names a usage limit that stops a turn, its reset time, and `claude --resume`.

**Why:** no hook input gives Claude its usage or its context size. A handoff
and `/clear` keep the facts that Claude chooses, and a `/compact` costs a
full turn over the large context. With `autoCompactWindow` at 150k, Claude
Code compacts at about 117k tokens (window, minus 20k for output, minus a
13k buffer), so the context note comes first.

### Model Lock And Plan Awareness (`model_lock`, `claude_plan`)

See [Models](models.md).

### Scratchpad Pruning (`scratchpad_prune_days`, off)

**What:** at session start, deletes Claude Code scratchpads that nobody
touched for the number of days you set.

**Why:** builds left in scratchpads can take gigabytes. It is off by default,
because it deletes files.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `bash_guard`, `edit_guard`, `secret_redaction`, `nested_instructions`, `stop_gate`, `task_check`, `goal_loop_guard`, `compact_carryover`, `model_lock`, `commit_hygiene` | on | the hooks above |
| `subagent_guidance` | on | shared rules and report format for agents, and the `general-purpose` refusal |
| `ask_in_auto_mode` | off | asks about recoverable actions in auto mode too |
| `git_attribution` | on | adds the `Co-Authored-By` trailer and pull request footer |
| `allowed_models` | the four models | the models that the lock accepts |
| `claude_plan` | `auto` | `pro`, `max_5x`, `max_20x`, `team_standard`, `team_premium`, `enterprise`, or `api` |
| `usage_notes`, `turn_limit_handoff` | on | usage notes, and the subagent context and turn bounds |
| `scratchpad_prune_days` | `0` (off) | removes idle Claude Code scratchpads older than this many days |
