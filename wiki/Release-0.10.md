# Release 0.10

Release 0.10 added a status line, public documentation, and more usage checks.
It also made every message to Claude follow strict ASD-STE100.
The goal was to show the session state to the user and to cut wasted context.
A version in parentheses marks a change from a later patch of this line.
An entry with no version comes from 0.10.0.

## Added

- A stale-cache notice.
  The notice shows when the user sends a prompt after the prompt cache expired and the context is 100k tokens or more.
  This applies to the main conversation.
  It says that this turn reads the whole context uncached, and that a `/compact` now does the same.
  It suggests a handoff note and `/clear` for new work.
  The TTL is 1 hour, or 5 minutes with `CLAUDE_CODE_PROMPT_CACHE_TTL=5m` or `FORCE_PROMPT_CACHING_5M=1`.
  The message goes to the user only and adds nothing to the context.
  The `usage_notes` option controls it.
- A Bash guard deny for a `git commit` whose message has a Claude `Co-Authored-By` line when the `attribution` setting (or `includeCoAuthoredBy: false`) leaves that line out.
  Claude Code adds the line anyway in some sessions ([#4287](https://github.com/anthropics/claude-code/issues/4287), [#93007](https://github.com/anthropics/claude-code/issues/93007)).
- A status line (0.10.0, 0.10.1).
  - The main line shows the folder, the git state, the model and effort, and the context against the 200k handoff point.
    It also shows the cache expiry and hit ratio, the usage limits, and the pull request.
    Colors change at 75% and 90%.
  - It uses two rows: where the session works, then what it uses.
    A row that is too wide continues on the next row.
    Past three rows, parts drop by priority, and a limit at 75% or more stays.
  - It also shows the folder below the project, added directories, the worktree, the `--agent` name, the vim mode, and the session name.
    It also shows cache misses with the last cause, the spend limit, lines added and removed, and the session time.
  - The plugin sets `subagentStatusLine`.
    Each subagent row shows its context against the 150k subagent budget.
    Claude Code leaves `${CLAUDE_PLUGIN_ROOT}` empty in that command, so it runs a stub in the config directory that session start writes.
  - A plugin cannot set `statusLine`.
    So `/dotclaude:apply-settings-profile` offers it through `apply-statusline.mjs`.
    That script writes a stub that session start keeps pointed at the current plugin version.
  - The `statusLine` setting has `refreshInterval: 60`, so the clock and cache expiry of an idle session keep updating.
    To add it to an existing install, run `/dotclaude:apply-settings-profile` or `apply-statusline.mjs --apply` again.
- A nested-instructions hook.
  When a Bash command reads files in a subdirectory with its own `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md`, the hook adds that file to the context.
  It adds each file once for each session or subagent.
  Claude Code loads these files only for the Read tool ([#90450](https://github.com/anthropics/claude-code/issues/90450)).
  The `nested_instructions` option controls it.
- The usage report shows the prompt cache hit rate and the advisor share of cost.
- An open-task check.
  When Claude ends a turn with tasks pending or in progress, a Stop hook sends it back once to update the task list.
  The same set of open tasks blocks only once.
  The `task_check` option controls it.
- `just sandbox` runs Claude Code with the checkout as its plugin in a separate config directory.
  It skips onboarding and the trust dialog, and it gives the login token to `claude` in its environment only.
  `docs/sandbox.md`, now the [Sandbox](Sandbox) page, tells people and AI agents how to test in it.
  `just sandbox-clean` removes it.
  `just usage` runs the usage report.
- Public documentation in `docs/`, from `docs/README.md` (0.10.1).
  It is now this wiki, from [Home](Home).
  Each page tells what a part of dotclaude does and why, and links to the dossier for the evidence.
  The parts are hooks, models, agents and skills, working rules, the settings profile, the status line, and development.
- The `explain-dotclaude` skill (0.10.1).
  When the user asks why Claude or dotclaude did, blocked, or asked about something, Claude answers from the documentation.
  The answer gives the reason, its source, and how to change it.

## Changed

- Every message that goes to Claude follows strict ASD-STE100 and the prompting best practices of Claude.
  The messages are hook output, guard reasons, agent and skill prompts, and the system prompt.
  Each message gives the reason, says what to do, and puts code items in backticks.
  A guard that finds more than one problem writes each reason as its own sentence.
  `AGENTS.md` has the rule for new messages.
  Agent rules that had no reason now give one.
- Tests check what dotclaude does, not how its messages read.
  They check the decision, the file effects, and the facts that a message carries (paths, IDs, numbers).
  A reworded message no longer breaks a test.
- The dossier uses the official prompt-caching facts.
  An effort change keeps the cache on Opus 5.5 and Fable 5.1, `/model` loses it, and a 1-hour cache write costs 2x the input price.
- Subagents learn that Claude Code refuses their writes to `.md` files whose names start with `report`, `summary`, `findings`, or `analysis` ([#44657](https://github.com/anthropics/claude-code/issues/44657)).
- The usage-note levels (75% and 90%) moved to `hooks/lib/_budget.mjs` as `USAGE_LEVELS`.
  The status line shares them.
- The README is a short overview that links to the documentation (0.10.1).
  The hook details, options, settings profile, and development notes moved to `docs/`.
- The main status line counts only cache misses that something broke, for example a change of model, tool, or system prompt (0.10.2).
  It does not count misses from idle time past the cache lifetime (`ttl_expired_5m`, `ttl_expired_1h`).
  They break nothing, and the stale-cache notice already covers them.

## Removed

- Headroom support.
  Headroom compresses tool output with loss.
  In this repository it dropped words from text that Claude read as exact.
  Its saving is small against a cached context, and all agents needed its retrieval tool.
  The agents, `/dotclaude:setup-integrations`, and the session-start notice no longer name it.
  To remove it from a setup, run `headroom unwrap claude` and `claude mcp remove headroom`, and take `headroom wrap` out of the `claude` shell function.

## Fixed

- The usage report left out advisor calls, because the `usage` of the call does not count them.
  It now adds each `advisor_message` in `usage.iterations`.

Previous: [Release 0.9](Release-0.9) · Next: [Release 0.11](Release-0.11)
