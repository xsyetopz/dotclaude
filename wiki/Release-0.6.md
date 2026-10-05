# Release 0.6

Released 2026-09-27, in three patches: 0.6.0, 0.6.1, and 0.6.2.
Cuts background usage and disk use, and makes agents finish with a report.
0.6.0 adds a `justfile`, CI hardening, and settings that lower background requests.
0.6.1 and 0.6.2 fix the goal loop guard and the turn-limit failures of `codex-worker`.
A version in parentheses marks a patch.

> **Note:** After you update to 0.6.0, run `/dotclaude:apply-settings-profile` again.

## Added

- `justfile` (0.6.0): has the recipes `test`, `lint`, `validate`, `check`, and `bump`.
  `just bump <major|minor|patch|X.Y.Z>` sets the version in both manifests and dates the `[Unreleased]` CHANGELOG entries.
- `StopFailure` hook (0.6.2): shows a terminal notification when a turn stops on a usage limit.
  - The notification names the limit, its reset time from the usage that Claude Code caches, and `claude --resume <session>`.
  - The hook is part of the `usage_notes` option.
  - Claude Code shows it only in an interactive session, and only terminals that support OSC 9, 99, or 777 notifications show it.
- README notes (0.6.2):
  - The prompt cache TTL: `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` for API keys, cloud providers, and usage credits (subscriptions already get an hour on the main conversation).
  - Claude Code relays your latest chat message to every workflow agent ([#95369](https://github.com/anthropics/claude-code/issues/95369)).
- Turn-budget hook (0.6.2): refuses every tool except `SubagentHandback` once about 5% of a dotclaude agent's `maxTurns` remains, with a minimum of 3 turns.
  The next action of the agent is then its report.
  The hook counts the API calls of the agent since its latest prompt, resume, or wake-up, as Claude Code does.
- `codex-worker` Bash hook (0.6.2): limits `codex-worker` to three actions: write its brief file, run `run-codex.mjs`, and read the report.
  Given the task text, Haiku edited the files itself with a shell heredoc and never started Codex.
  The prompt alone did not stop it.
- Optional integrations (0.6.0): `/dotclaude:setup-integrations` offers two.
  - `tgrep`: indexed text search.
    It installs the tool, indexes the project, and adds `.tgrep/` to the global excludes file of git.
  - `fast-compact`: `/fc`, which trims old tool output with Jev.
    Setup uses the right Jev provider and model, and states dotclaude's measured trade-off first.
- Disk use controls (0.6.0):
  - dotclaude prunes its per-session hook state at session start when it is 30 days old.
    This matches the default transcript retention of Claude Code.
  - The `scratchpad_prune_days` option (off by default) removes Claude Code session scratchpads and loose entries under `/tmp/claude-<uid>` that nobody touched for that many days.
    It runs at session start and in the background, and it never prunes the current session.
  - For a one-time cleanup, run `bun hooks/session-start/prune-scratchpads.mjs --days <n>` from the plugin folder.
    It is a dry run unless you give `--apply`.

## Changed

- CI (0.6.0): runs with a read-only token, actions pinned by commit, per-job timeouts, and cancelled superseded pull-request runs.
  It checks format and import order as well as lint, covers `scripts/`, and reports one `all-green` check to require.
- Background usage (0.6.0): the settings profile cuts it.
  Per the costs and prompt-caching docs of Claude Code, each of these settings sends a request that re-reads the conversation.
  - `autoCompactWindow: 400000`, or 200000 on Pro, Max 5x, and Team seats.
    The default on current models is about 967k, and every turn re-reads context up to that size.
  - `promptSuggestionEnabled: false`.
    Suggestions cost an extra request after every response.
  - `awaySummaryEnabled: false`.
    There is no automatic session recap when you step away, and `/recap` still works.
  - `crossSessionInbound: "hold"`.
    Messages from your other sessions wait and do not start idle turns.
- Lean prompt (0.6.0): the profile sets `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`, the lean built-in prompt of Claude Code.
  Claude Code already uses this prompt in some interactive sessions.
  It is about 6.6k tokens shorter per request, and the tools are unchanged.
  A one-word `claude -p` request measured 26,671 input tokens without it and 20,038 with it.
  Most of the cut is the long auto-memory instructions.
- `/goal` conditions (0.6.0): the output style asks for three parts.
  They are an end state that the output of Claude shows, how to check it, and a turn bound.
  Reason: the goal evaluator reads only the transcript.
- Temp cleanup (0.6.0): the output style and the subagent conventions ask Claude to remove used build output, clones, and large dumps from the temp folder.
  Nothing else removes them.
- Fable deny rule (0.6.0): the settings profile drops `Agent(model:claude-fable*)`.
  Permission rules match the alias that the Agent tool sends (`fable`), never a full model ID, so that rule could not match.
- Frontmatter check (0.6.0): the edit guard denies a `Write` or `Edit` that would leave the YAML frontmatter of a Markdown file unparseable.
  An example is an unquoted `description: Does a thing: then another`.
  The denial names the parser error, so Claude quotes the value.
- Global `CLAUDE.md` block (0.6.0): names `tgrep`, `scc`, `tokei`, `dasel`, and `mlr` when they are installed.
  It gives an example only for tools that are present.
- Turn-budget hook (0.6.2): the hook and the notice that describes it follow the `turn_limit_handoff` option.
- `code-reviewer` (0.6.2): may use 60 turns instead of 40.
  Its median review used 36 turns, and half of the reviews since 0.5.0 hit the cap.
  A review that stops at its cap delivers no findings.
- `codex-fanout` (0.6.2): gives each worker a brief file instead of the task text.
  It checks the report file and `git status` of a stopped worker before it dispatches the item again.
- Bash guard (0.6.2): applies its Codex model and plan rules to the `--model` option of `run-codex.mjs`.

## Fixed

- `/goal` loop guard (0.6.1): it never fired unless the goal's condition started with `Goal:`.
  Claude Code puts the condition itself in the feedback text (`[@GOAL.md]: …`).
  The guard now counts the `goal_status` records of the transcript.
- `codex-worker` out of turns (0.6.1, 0.6.2):
  - 0.6.1: Codex's `workspace-write` sandbox keeps `.git`, `.agents`, and `.codex` read-only, so workers used their 12 turns without an edit.
    `codex-worker` now stops before it starts Codex when a file in scope is under one of those folders, and `codex-fanout` keeps those files out of the queue.
  - 0.6.1: `codex-worker` no longer reads the files in scope or polls with `sleep` while Codex runs.
    It waits for the background completion notice.
  - 0.6.2: on 0.6.1, all 7 runs in one session stopped at the 12-turn limit with no report, and two finished only after the orchestrator continued them.
    Haiku polled with `sleep` and `until` loops, ran Codex in the foreground, and did the acceptance steps of the brief itself.
  - 0.6.2: the worker now runs one script, `skills/codex-fanout/scripts/run-codex.mjs`.
    The script checks the setup, runs Codex, and prints a report with the git state.
    It flags writes that the sandbox of Codex denied under `.git`, `.agents`, or `.codex`.
    The worker runs as a background agent, so a run longer than the Bash timeout moves to the background, and the worker waits for the completion notice.
- Agents out of turns (0.6.2): agents still ran into their turn limit without a report.
  Of 13 capped runs after 0.5.0 told agents their limit, none reported before it.
  The turn-budget hook above is the fix.
- Git settings that run a program (0.6.2): the Bash guard asked only about `core.hooksPath`.
  It now also asks when `-c`, `--config-env`, `git config`, or git environment variables (`GIT_SSH_COMMAND`, `GIT_CONFIG_KEY_n`, and others) set one of these keys:
  - `core.fsmonitor`, `core.sshCommand`, `core.pager`, or `diff.external`
  - a filter driver
  - a `!` alias to a program
  - Values such as `cat`, `less`, `true`, and empty still pass.
- Agent prompts (0.6.2): they and the subagent conventions said that the final message reaches the caller.
  In auto mode only the `SubagentHandback` report reaches it, so they now say "report".

Previous: [Release 0.5](Release-0.5) · Next: [Release 0.7](Release-0.7)
