# Hooks

Part of the [dotclaude documentation](README.md). Each hook enforces a rule
that a program can check, because a rule stated only in prose did not hold in
the measured week ([usage evidence](dossier/usage.md)). Turn off a hook in
`/config` or with `claude plugin configure dotclaude@dotclaude`. The option
name is after each heading.

Every dotclaude message starts with `[dotclaude]`, except the text of a
permission prompt, which Claude Code already labels. The guards never approve
anything, and they fail open, so a bug in a guard does not stop your work.
After you approve an ask and the tool runs, the guards do not ask again in
that session for the same command or edit. Each deny and ask goes to
`verdicts.jsonl` in the plugin data directory, so you can see which rules
fire often. The guards are a best-effort parser, not a sandbox. For hard
isolation, use Claude Code's
[sandbox](https://code.claude.com/docs/en/sandboxing). To run a command that
a guard denied, type `! <command>`.

## Guards

### Bash Guard (`guard_bash`)

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

**What:** asks before a `DesignSync` call that changes a Claude Design
project, unless the session started the `/design-sync` skill.
Reads, such as `list_projects` and `get_file`, pass.

**Why:** the tool description permits `DesignSync` only in `/design-sync`,
which the user starts.
Claude Code can hide that skill and still offer the tool.
In one session, Claude did not find the skill and uploaded a brief and nine
reference images to a new project without it.

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

The Bash guard also asks about infrastructure changes, new dependencies,
turned-off TLS checks, tracked test file deletion, and two more database
reset flags.
They are on [Guard Asks](hooks-asks.md#bash-guard-asks).

### Edit Guard (`guard_edit`)

**What:** asks before an edit removes test assertions or skips an existing
test. It also asks before edits to Claude settings, generated files, or
lockfiles.
When you approve an ask for removed assertions or a skip marker, the tool runs,
and the other test edits of that kind pass until your next message.
Your next message ends the approval.
Other asks, such as TLS or generated files, stay one by one.

**Why:** a removed assertion makes a failing test pass without a fix, and it
hides the signal. An edit to Claude settings can change what Claude is
permitted to do, so you approve it. A tool writes generated files and
lockfiles, and a hand edit is lost or drifts from its source.

The Edit guard also asks about proof escapes and turned-off TLS checks in code.
They are on [Guard Asks](hooks-asks.md#edit-guard-asks).

### Agent-Loop Oracle (`guard_edit`)

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

### Commit Hygiene (`git_commit_hygiene`)

**What:** on `git commit`, asks when the staged files include `.DS_Store`,
`.env` files, keys, build output, or a lockfile without its manifest.

**Why:** a commit is hard to take back once it is pushed, and a pushed secret
must be rotated. When the `attribution` setting leaves the Claude trailer out,
the guard also denies a commit message that still has it
([#4287](https://github.com/anthropics/claude-code/issues/4287)).

### Secret Redaction (`guard_secrets`)

**What:** runs [Betterleaks](https://github.com/betterleaks/betterleaks) on
every tool output and replaces each secret with `[REDACTED:<rule>]` before
Claude sees it. Without `betterleaks` on `PATH`, output passes through and
session start says so. gitleaks is not used. Keep it for pre-commit hooks.

**Why:** a `tail ~/.zshrc` put an API key into the context. Tool output goes
to the API and stays in the transcript. Betterleaks runs from the temp
directory with `--ignore-gitleaks-allow`, so a repository cannot turn
redaction off. Live validation stays off, so no secret leaves the machine. A
run takes about 30 ms.

### Quiet In Auto Mode (`guard_ask_in_auto`, off)

**What:** in auto mode, recoverable actions do not ask. Irreversible and
public actions still ask.

**Why:** an unattended session that waits on a prompt does no work. Auto
mode's own classifier already decides recoverable actions.

## Gates

### Verify-Before-Stop (`gate_verify`)

**What:** sends Claude back once when it edits code and stops without a test,
build, or lint run after the edit.
It does the same when the last check after an edit failed.
A failed check with no edit passes, because a read-only agent such as `test-runner` reports failures.
When Claude marks a task completed after a code edit with no check after it, the gate keeps the task open once, and names the task.
An edit with no check passes when the project root shows no tests.
These show tests: a `justfile` `test` or `check` recipe, a `package.json` test script, a test command in `CLAUDE.md` or `AGENTS.md`, or a build file.
The build files are `Cargo.toml`, `go.mod`, a `Makefile` with a `test` or `check` target, `pyproject.toml`, `setup.cfg`, `setup.py`, `tox.ini`, `noxfile.py`, `pytest.ini`, Gradle and Maven files, .NET project and solution files, `CMakeLists.txt`, `meson.build`, Bazel files, `build.zig`, `Package.swift`, `mix.exs`, `deno.json`, `pubspec.yaml`, `Gemfile`, and `composer.json`.
In a project with none of these, Claude cannot run a check, and a block would only add a turn.
Subagents get the test command that a build file implies only when the file shows it, for example `cargo test` for `Cargo.toml`, or `pytest` for a `pyproject.toml` with a `[tool.pytest]` table.
The gate reads only the edit and check ledger, not the reply, because a reply can be in any language.
Each check has a kind.
A `run` check runs the code: a test, a build, a compile, a type check, or a run of a program or notebook.
A `static` check reads the code: a lint run or a format check.
A task runner task with a name that the gate does not know counts as `run`.
After a code edit, a `static` check alone does not satisfy the gate or the task gate when the project has a test command.
The reason names the last check and the command to run.
A project with no test command accepts a `static` check.
A failed `run` check stays reported until a later `run` check passes, also when a lint run passes after it.

**Why:** "done" without a check that ran moves the finding of defects to you.
The working rules say this in prose, and the gate enforces it.
A lint run shows style, and it does not show that the change works.

### Open-Task Check (`gate_tasks`)

**What:** sends Claude back once when it ends a turn with tasks still pending
or in progress. It does not apply to subagents, or to a turn that ends with
`AskUserQuestion` or `ExitPlanMode`, because the user answers first.

**Why:** a stale task list tells you that work is open when it is done, or
done when it is open. Claude marks each task done or says why it stays open.
The engine reminders to use the task tools are then left out.

### Loop Reviews (`gate_tasks`)

**What:** sends Claude back once when `.dotclaude/loop/slices.jsonl` has a
slice with `status: "implemented"`, and names the slices. Claude gives each
diff to `reviewer` with the `diff` lens and sets the status to `reviewed`, or sets `failed`
with a reason. The same set of slices blocks at most once in a session. The
gate does not apply to subagents, to a turn that waits for the user, or while
a background shell or subagent runs.

**Why:** the reviewer that sees only the diff is the step that finds what the
implementer rationalized. A slice that merges without it loses that check.
One block at most lets the user pause a loop and stop.

### Stalled Goals (`gate_goal_stall`)

**What:** ends the turn and pauses a `/goal` when its check blocks a stop
twice in a row with no work between.

**Why:** in one session, Claude answered "I'm staying stopped" to 9 goal
blocks in a row. Each round re-read about 710k tokens of context and did no
work.

## Context

The working rules, nested instructions, session files, compaction carry-over, edit-miss
lines, handoff pointer, cold-cache notice, instruction-file lint, and
line-break check are on [Context Hooks](hooks-context.md).

## Usage

The usage bounds, usage notes, model lock, and scratchpad pruning are on
[Usage Hooks](hooks-usage.md). Where each hook runs is on
[Hooks Module](mods.md).

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `guard_bash`, `guard_edit`, `guard_secrets`, `context_nested_instructions`, `context_session_files`, `gate_verify`, `gate_tasks`, `gate_goal_stall`, `context_compact_carryover`, `context_handoff_pointer`, `model_lock`, `git_commit_hygiene` | on | the hooks above |
| `agent_guidance` | on | shared rules and report format for agents, the `general-purpose` refusal, and the [hidden built-in agents](mods.md#built-ins-that-dotclaude-replaces) |
| `context_auto_clear` | on | at 100k tokens of main context, the next typed prompt saves a handoff note, runs `/clear`, and sends the prompt again, see [Optional Features](mods.md#optional-features) |
| `context_compaction_handoff` | on | before a main compaction, saves a handoff note and adds it to the compacted conversation, see [Optional Features](mods.md#optional-features) |
| `notify_desktop` | on | a desktop notification at the end of a main turn, when Claude asks a question, and when it asks for a permission, with one reminder after 5 minutes, see [Optional Features](mods.md#optional-features) |
| `guard_ask_in_auto` | off | asks about recoverable actions in auto mode too |
| `context_line_breaks` | off | the [line-break check](hooks-context.md#line-breaks-context_line_breaks), for projects that use semantic line breaks |
| `git_attribution` | on | adds the `Co-Authored-By` trailer and pull request footer |
| `model_allowed` | the four models | the models that the lock accepts |
| `model_plan` | `auto` | `pro`, `max_5x`, `max_20x`, `team_standard`, `team_premium`, `enterprise`, or `api` |
| `usage_notes`, `usage_agent_bounds` | on | usage notes, and the subagent context and turn bounds |
| `usage_scratchpad_prune_days` | `0` (off) | removes idle Claude Code scratchpads older than this many days |
