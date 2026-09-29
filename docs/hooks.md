# Hooks

Part of the [dotclaude documentation](README.md). Each hook enforces a rule
that a program can check, because a rule stated only in prose did not hold in
the measured week ([usage evidence](dossier/usage.md)). You can turn off each
hook in `/config` under dotclaude. The option name is after each heading.

Every dotclaude message starts with `[dotclaude]`. The guards never approve
anything, and they fail open, so a bug in a guard does not stop your work.
They are a best-effort parser, not a sandbox. For hard isolation, use Claude
Code's [sandbox](https://code.claude.com/docs/en/sandboxing). To run a
command that a guard denied, type `! <command>`.

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
`rg`, `fd`, and `git grep` skip those directories.

**Why:** an agent's `grep -r` in a repository with an 8.9 GB `.build/`
directory hung, and it would have filled the context with generated files.
Each turn re-reads the whole context, so text that enters the context costs
usage on every later turn ([usage evidence](dossier/usage.md)).

### Edit Guard (`edit_guard`)

**What:** asks before an edit removes test assertions or skips an existing
test. It also asks before edits to Claude settings, generated files, or
lockfiles.

**Why:** a removed assertion makes a failing test pass without a fix, and it
hides the signal. An edit to Claude settings can change what Claude is
permitted to do, so you approve it. A tool writes generated files and
lockfiles, and a hand edit is lost or drifts from its source.

### Commit Hygiene (`commit_hygiene`)

**What:** on `git commit`, asks when the staged files include `.DS_Store`,
`.env` files, keys, build output, or a lockfile without its manifest.

**Why:** a commit is hard to take back once it is pushed, and a pushed secret
must be rotated. When the `attribution` setting leaves the Claude trailer out,
the guard also denies a commit message that still has it
([#4287](https://github.com/anthropics/claude-code/issues/4287)).

### Secret Redaction (`secret_redaction`)

**What:** runs [gitleaks](https://github.com/gitleaks/gitleaks) on every tool
output and replaces each secret with `[REDACTED:<rule>]` before Claude sees
it. Without gitleaks on `PATH`, output passes through and session start says
so.

**Why:** a `tail ~/.zshrc` put an API key into the context. Tool output goes
to the API and stays in the transcript. gitleaks runs with
`--ignore-gitleaks-allow`, so a repository cannot turn redaction off. A run
takes about 30 ms.

### Quiet In Auto Mode (`ask_in_auto_mode`, off)

**What:** in auto mode, recoverable actions do not ask. Irreversible and
public actions still ask.

**Why:** an unattended session that waits on a prompt does no work. Auto
mode's own classifier already decides recoverable actions.

## Gates

### Verify-Before-Stop (`stop_gate`)

**What:** sends Claude back once when it edits code and stops without a test,
build, or lint run. It does the same when Claude says that tests pass after a
failure.

**Why:** "done" without a check that ran moves the finding of defects to you.
The working rules say this in prose, and the gate enforces it.

### Open-Task Check (`task_check`)

**What:** sends Claude back once when it ends a turn with tasks still pending
or in progress.

**Why:** a stale task list tells you that work is open when it is done, or
done when it is open. Claude marks each task done or says why it stays open.

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
in the foreground.

**Why:** calls with a context over 150k tokens were 74.7% of the measured
cost. `general-purpose` runs were 17.6% of it, in place of the cheaper
dotclaude agents. Claude Code delivers nothing from an agent that it stops at
its turn limit, so the agent must report first. Background agents started 501
of 861 main turns. With the bound at 150k, 34 of 69 `implementer` runs still
passed 100k, and subagent calls from 100k to 150k were 9% of the cost. The
reviewers keep 150k: a review finds defects across files only while the whole
change is in view, a fresh reviewer writes that view to the cache again, and 1
of 14 `code-reviewer` runs reached 150k. See
[enforced bounds](dossier/design.md#2-enforced-bounds)
and [usage evidence](dossier/usage.md).

### Usage Notes (`usage_notes`)

**What:** tells Claude once when the session or weekly limit passes 75% and
90%. When a turn stops on a usage limit, a terminal notification names the
limit, its reset time, and the `claude --resume` command. When a prompt
arrives after the prompt cache expired on a context of 100k tokens or more,
a message tells you that a handoff and `/clear` cost less than going on or
`/compact`.

**Why:** near a limit, Claude can route the remaining work to use less. A
prompt after the cache expired, and a `/compact` after it, write the whole
context to the cache again ([prices](dossier/plans-and-models.md#prices)).
A handoff note and `/clear` start from a small context.

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
| `cloakbrowser`, `cloakbrowser_humanize`, `cloakbrowser_headless`, `captcha_ocr_ddddocr` | agent-browser, no OCR | browser backend and CAPTCHA fallback |
