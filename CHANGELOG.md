# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

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

## [0.7.0] - 2026-09-28

### Added

- `docs/pro-first-usage.md`: where this machine's Max 20x week went, what
  that means for Pro, the Codex quota and dossier findings, and the case for
  and against bringing back the GPT-5.6 models.
- A context budget for every subagent. Once an agent's context passes 150k
  tokens, its tool calls are refused and its next action is its report. A
  fork starts with its parent's context, so it gets 50k tokens of growth
  instead. In the measured week, 83% of `implementer` cost and 85% of
  `general-purpose` cost came from calls above 100k tokens. The hook is now
  `enforce-agent-budget.mjs`, still under the `turn_limit_handoff` option,
  and subagents are told the limit at start.
- `general-purpose` agents are refused, with a pointer to the dotclaude agent
  for the job (part of `subagent_guidance`). They were 17.5% of the measured
  week: 83 explicit calls, mostly implementation slices with no turn limit.
  With forks off, leaving `subagent_type` out spawns `general-purpose`, so
  that is refused too.
- Subagents run in the foreground. The same hook sets
  `run_in_background: false`, and the settings profile sets
  `CLAUDE_CODE_FORK_SUBAGENT=false`, since fork mode forces every subagent
  into the background. A background agent woke the main conversation when it
  finished, once for its report and once for its task notification: 501 of
  861 main turns in the measured week, 20.6% of cost. A foreground agent
  returns its report in the turn that spawned it, and agents spawned in one
  message still run together; the main session waits while they run.
- `scripts/usage-report.mjs` reports where the last N days of Claude Code
  usage went: API-equivalent cost by agent type, the share from calls with
  context past 150k tokens, the share spent on full cache rewrites, and the
  main turns that background agents started.
- `hooks/lib/_budget.mjs` holds the usage bounds. A test checks that the
  output style, the settings profile, and the option text agree with it, and
  that the output style plus the agent and skill descriptions stay under
  21.5 KB.

### Removed

- Codex support: the `codex-worker` and `codex-reviewer` agents, the
  `codex-fanout` skill, Codex setup (`skills/setup-integrations/codex/`,
  `configure-codex.mjs`, `build-codex-catalog.mjs`), the `codex_delegation`
  and `allowed_codex_models` options, the Codex Bash-guard rules, and every
  other Codex mention across the hooks, output style, and settings profile.
  A second model source cost more to maintain than it gave, and delegation
  spent Claude turns forwarding briefs to GPT-6 workers and reviewing their
  diffs. If you ran `/dotclaude:setup-integrations codex`, you may delete
  the files it wrote under `$CODEX_HOME` (usually `~/.codex/`):
  `dotclaude-luna.config.toml`, `dotclaude-review.config.toml`,
  `dotclaude-catalog-interactive.json`, `dotclaude-catalog-worker.json`,
  `dotclaude-catalog-review.json`, and any
  `*.dotclaude-backup-<timestamp>` files next to them. It also set
  `service_tier`, `model_catalog_json`, `[features] fast_mode`, and on the
  Plus plan `model`, in `config.toml`; remove those lines yourself if you
  want Codex's own defaults back.
- The skills that are not part of dotclaude's own machinery: `blind-spots`,
  `challenge`, `fresh-eyes`, `lessons-learned`, `polish`, `recap`,
  `troubleshoot`, and `review-code-changes`. dotclaude keeps the skills its
  features use (settings profile, integrations, handoff, browser, CAPTCHA).
  General workflow skills belong in
  [xsyetopz/skills](https://github.com/xsyetopz/skills), where
  `debug-software-failures` covers `troubleshoot`; the code-reviewer agent
  still runs on request. Four of the removed skills were in the skill
  listing on every turn.
- `apply-settings` no longer deletes settings that earlier profiles wrote.
  If your `env` still holds `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-5-5`
  from 0.4.0, delete it yourself; otherwise every `sonnet` agent runs on Opus
  5.5. `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` from 0.2.0 is no longer
  removed either. Claude Code 2.1.283 still reads it, so the old claim that
  it was unused was wrong.
- The CodeGraph hooks and the `codegraph_hint` option. The session-start note
  and the per-prompt symbol list repeated what the CodeGraph section that
  `codegraph install` writes into `~/.claude/CLAUDE.md` already says. The
  setup skill now checks for that section and still tells you to remove the
  global `codegraph prompt-hook` entry.

### Changed

- A `/dotclaude:` skill typed mid-message now runs through the Skill tool
  instead of having its body pasted into the context. The skill loads the way
  Claude Code loads it (forks, `!` commands, model and tool settings), and a
  large skill is no longer truncated at 9.5 KB. It costs one extra call per
  mid-message skill.
- The settings profile turns off built-in Claude Code features that cost
  context or turns, from `profiles/optional.json`. Each is applied unless you
  skip it with `--skip`: the Artifact, Workflow, `ScheduleWakeup`, cron, and
  ReportFindings tools (about 46 KB on every request together), the advisor,
  the Explore and Plan agents, bundled skills, auto memory, the refusal
  retry, and auto-updates. The profile stamp covers both files.
- The output style makes the main conversation the default place to work:
  delegate only output that would flood the context, or parallel slices the
  user asks for.
- The settings profile no longer denies `AskUserQuestion`. Its 4.9 KB per
  request is about $2 a week of cached reads at the measured volume, and a
  structured question is worth that. `apply-settings` does not remove old
  denies, so delete `"AskUserQuestion"` from `permissions.deny` in
  `~/.claude/settings.json` yourself.
- Limits are sized for Pro and Plus and apply on every plan; larger plans
  only reach them later. Two uniform settings follow from this:
  - The settings profile compacts at 200k tokens on every plan; it was 400k
    on Max 20x. Run `/dotclaude:apply-settings-profile` to apply it. The
    session note asks for a handoff past about 200k on every plan, and the
    output style says 200k instead of 400k.
- Session start detects a stale settings profile with one stamp instead of a
  check per release. `/dotclaude:apply-settings-profile` writes
  `env.DOTCLAUDE_SETTINGS_PROFILE`, a hash of the shipped profile. When it
  is missing or differs, session start asks you to apply the profile again.
  This replaces the checks for a missing Haiku mapping, a missing effort
  cap, and the old 400k compaction window. Every existing install sees the
  notice once.
- The settings profile runs 3 subagents at once, and 3 agents at once in a
  workflow; it was 6.

### Fixed

- A `/dotclaude:` skill name inside pasted text or a `>` quote no longer
  loads that skill.

## [0.6.2] - 2026-09-27

### Added

- When a turn stops on a usage limit, a `StopFailure` hook shows a terminal
  notification with the limit that was hit, its reset time from Claude
  Code's cached usage, and `claude --resume <session>`. It is part of the
  `usage_notes` option. Claude Code shows it only in an interactive session,
  and only terminals that support OSC 9, 99, or 777 notifications display it.
- README notes on the prompt cache TTL (`CLAUDE_CODE_PROMPT_CACHE_TTL=1h` for
  API keys, cloud providers, and usage credits; subscriptions already get an
  hour on the main conversation) and on Claude Code relaying your latest chat
  message to every workflow agent
  ([#95369](https://github.com/anthropics/claude-code/issues/95369)).

### Changed

- The turn-budget hook and the notice that describes it follow the
  `turn_limit_handoff` option.
- `code-reviewer` may use 60 turns instead of 40. Its median review used
  36, half of the reviews since 0.5.0 hit the cap, and a review cut off at
  its cap delivers no findings.

### Fixed

- Agents still ran into their turn limit without a report. Of 13 capped
  runs after 0.5.0 told agents their limit, none reported before it. A new
  hook now refuses every tool except `SubagentHandback` once about 5% of a
  dotclaude agent's `maxTurns` remains (at least 3 turns), so its next
  action is its report. It counts the agent's API calls since its latest
  prompt, resume, or wake-up, as Claude Code does.
- The Bash guard asked only about `core.hooksPath` among git settings that
  run a program. It now also asks when `-c`, `--config-env`, `git config`,
  or git's environment variables (`GIT_SSH_COMMAND`, `GIT_CONFIG_KEY_n`,
  and others) set a key such as `core.fsmonitor`, `core.sshCommand`,
  `core.pager`, `diff.external`, a filter driver, or a `!` alias to a
  program. Values like `cat`, `less`, `true`, and empty still pass.
- `codex-worker` still ran out of turns on 0.6.1: all 7 runs in one session
  stopped at the 12-turn limit with no report, and 2 finished only after
  the orchestrator continued them. Haiku polled with `sleep` and `until`
  loops, ran Codex in the foreground, and carried out the brief's
  acceptance steps itself. The worker now runs one script,
  `skills/codex-fanout/scripts/run-codex.mjs`, which checks the setup, runs
  Codex, and prints a report with the git state, flagging writes Codex's
  sandbox denied under `.git`, `.agents`, or `.codex`. The worker runs as a
  background agent, so a run longer than the Bash timeout moves to the
  background and the worker waits for the completion notice. The Bash
  guard applies its Codex model and plan rules to the script's `--model`.
- A new Bash hook limits `codex-worker` to writing its brief file, running
  that script, and reading the report. Given the task text, Haiku edited
  the files itself with a shell heredoc and never started Codex, and the
  prompt alone did not stop it.
- `codex-fanout` gives each worker a brief file instead of the task text,
  and checks a stopped worker's report file and `git status` before
  dispatching the item again.
- Agent prompts and the subagent conventions said the final message is what
  reaches the caller. In auto mode only the `SubagentHandback` report does,
  so they now say "report".

## [0.6.1] - 2026-09-27

### Fixed

- The `/goal` loop guard never fired unless the goal's condition started
  with `Goal:`. Claude Code puts the condition itself in the feedback text
  (`[@GOAL.md]: …`), so the guard now counts the transcript's
  `goal_status` records instead.
- `codex-worker` stops before starting Codex when a file in scope is under
  `.git`, `.agents`, or `.codex`. Codex's `workspace-write` sandbox keeps
  those read-only, so workers used up their 12 turns without an edit.
  `codex-fanout` keeps those files out of the queue.
- `codex-worker` no longer reads the files in scope or polls with `sleep`
  while Codex runs. It waits for the background completion notice, so
  exploring and polling no longer use up its turns before Codex finishes.

## [0.6.0] - 2026-09-27

After updating, re-run `/dotclaude:apply-settings-profile`.

### Added

- A `justfile` with `test`, `lint`, `validate`, `check`, and `bump`
  recipes. `just bump <major|minor|patch|X.Y.Z>` sets the version in both
  manifests and dates the `[Unreleased]` CHANGELOG entries.

### Changed

- CI runs with a read-only token, actions pinned by commit, per-job
  timeouts, and cancelled superseded pull-request runs. It checks format and
  import order as well as lint, covers `scripts/`, and reports one
  `all-green` check to require.
- Settings profile cuts background usage. Per Claude Code's costs and
  prompt-caching docs, each of these sends a request that re-reads the
  conversation:
  - `autoCompactWindow: 400000`, or 200000 on Pro, Max 5x, and Team seats.
    The default on current models is about 967k, and every turn re-reads the
    context up to that size.
  - `promptSuggestionEnabled: false`: suggestions cost an extra request after
    every response.
  - `awaySummaryEnabled: false`: no automatic session recap when you step
    away; `/recap` still works.
  - `crossSessionInbound: "hold"`: messages from your other sessions wait
    instead of starting idle turns.
- The output style asks for `/goal` conditions with an end state Claude's
  own output shows, how it is checked, and a turn bound, since the goal
  evaluator reads only the transcript.
- Settings profile sets `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`, Claude Code's
  lean built-in prompt. It is the same prompt Claude Code already rolls out
  to some interactive sessions, and it is about 6.6k tokens shorter per
  request: a one-word `claude -p` request measured 26,671 input tokens
  without it and 20,038 with it. Most of the cut is the long auto-memory
  instructions; the tools are unchanged.
- `/dotclaude:setup-integrations` offers two optional integrations:
  - `tgrep`: indexed text search. Installs it, indexes the project, and adds
    `.tgrep/` to git's global excludes file.
  - `fast-compact`: `/fc`, which trims old tool output with Jev. It is set up
    with the right Jev provider and model, and with dotclaude's measured
    trade-off stated first.
- Disk use:
  - dotclaude's per-session hook state is pruned at session start once it is
    30 days old, matching Claude Code's default transcript retention.
  - The test suite keeps every temporary folder under one folder per run and
    deletes it afterwards. Before this, each run left about 14 folders in the
    system temp folder; one machine had collected 4,606 (109 MB).
  - `scratchpad_prune_days` (off by default) deletes Claude Code session
    scratchpads and loose entries under `/tmp/claude-<uid>` that nobody has
    touched for that many days, at session start and in the background. The
    current session is never pruned. For a one-time cleanup, run
    `bun hooks/session-start/prune-scratchpads.mjs --days <n>` from the plugin
    folder; it is a dry run unless `--apply` is given.
  - The output style and the subagent conventions ask Claude to remove build
    output, clones, and large dumps it put in the scratchpad or temp folder
    once they are used, since nothing else deletes them.
- The settings profile drops `Agent(model:claude-fable*)`. Permission rules
  match the alias the Agent tool sends (`fable`), never a full model ID, so
  that rule could not match anything.
- The edit guard denies a `Write` or `Edit` that would leave a Markdown
  file's YAML frontmatter unparseable, such as an unquoted
  `description: Does a thing: then another`, and names the parser error so
  the value gets quoted.
- The global `CLAUDE.md` block names `tgrep`, `scc`, `tokei`, `dasel`, and
  `mlr` when installed, and gives an example use only for tools that are
  present.

## [0.5.1] - 2026-09-27

### Fixed

- A `/goal` whose condition is unmet no longer burns turns when Claude has
  been told to stop.
  - Claude Code's goal check blocks every stop, and in one session Claude
    replied "I'm staying stopped" to 9 blocks in a row until Claude Code gave
    up. Each round re-read about 710k tokens of context.
  - A new Stop hook (`goal_loop_guard`, on by default) ends the turn after two
    goal blocks in a row with no tool call in between. Claude Code then
    pauses the goal, and the note names `/goal <new condition>` to change it,
    `/goal clear` to end it, and sending a message to resume.
  - The output style tells Claude to propose a replacement condition with
    `ProposeGoal` when a goal no longer matches the user's request, or to
    name those commands once, instead of restating that it is stopping.

## [0.5.0] - 2026-09-26

Requires Claude Code v2.1.283 or later. After updating:

1. Restart Claude Code.
1. Re-run `/dotclaude:apply-settings-profile`. It adds Sonnet 5 to
   `availableModels`, replaces the Sonnet deny with Fable denies, and removes
   the 0.4.0 mapping of `sonnet` to Opus 5.5.
1. If you set `allowed_models` yourself, add `claude-sonnet-5` to it.
1. If you use the Codex agents, re-run `/dotclaude:setup-integrations codex`.

`docs/subscription-tiers.md` holds the research behind this release: how the
Fable limit works, plan names in Claude Code and Codex, prices, dossier
findings, and a scan of real session usage.

### Added

- Claude plan awareness:
  - The `claude_plan` option, default `auto`, reads the plan from Claude Code's
    cached account in `~/.claude.json`. It uses `organizationType`, the
    rate-limit tier, `billingType`, and `hasExtraUsageEnabled`, and never
    touches the token.
  - Plans: `pro`, `max_5x`, `max_20x`, `team_standard`, `team_premium`,
    `enterprise`, `api`.
  - At session start, a note says what the plan means for model choice:
    - Max and premium seats: Fable draws up to 50% of the same weekly limit
      as every other model.
    - Pro: Fable runs on paid credits.
    - API: per-token price ratios.
    - Plans with a small 5-hour window: hand off or compact earlier.
- Once Codex is set up, a session note points bounded, fully specified tasks at
  `codex-worker`. It runs on the ChatGPT plan's quota instead of Claude's.
- Every dotclaude agent is told its `maxTurns` at start, and asked to write its
  report before it reaches the limit. In the transcripts scanned for this
  release, 39 `implementer` runs and 8 `code-reviewer` runs were cut off at
  their limit.
- Agents on Sonnet 5 get a scope reminder, because Sonnet 5 follows
  instructions literally, per Anthropic's prompting guide.
- Turn-limit handoff (`turn_limit_handoff`, on by default):
  - An agent that stopped at its turn limit is not resumed.
  - The first `SendMessage` to it is rewritten into a request for a handoff
    report, and later messages are denied, pointing at a fresh agent.
  - Why: a resumed agent keeps its whole context, and every turn re-reads it.
    In the scanned transcripts, `implementer` tasks ran a median of 68 turns
    (90th percentile 115, max 320), with context up to 856k.
- Usage notes (`usage_notes`, on by default):
  - Reads Claude Code's cached `/usage` numbers from `~/.claude.json`, at most
    an hour old, including the Fable cap.
  - Tells Claude once when the session or weekly limit passes 75%, and again
    at 90%.
  - No token is read and nothing is fetched.
- Every message dotclaude shows Claude or the user starts with `[dotclaude]`.

### Changed

- Sonnet 5 is allowed again: in the default `allowed_models`, the profile's
  `availableModels`, and the managed drop-in. The `sonnet` alias no longer maps
  to Opus 5.5.
- `implementer` runs on Sonnet 5 at medium effort. Claude passes
  `model: "opus"` for a slice that needs design judgment or failed on Sonnet.
- The profile's `CLAUDE_CODE_SUBAGENT_MODEL` is now Sonnet 5, so built-in
  `general-purpose`, `Explore`, and `Plan` agents run on it.
- `mechanical-worker` and `test-runner` run on Sonnet 5 at low effort, and
  `docs-writer` on Sonnet 5 at medium. They were Opus 5.5 at low effort. Sonnet
  5 costs half as much as Opus 5.5 for input, output, and cache writes; cache
  reads cost the same on both.
- Fable is denied as a subagent model on every plan. A fresh Fable context
  costs about $0.47 API-equivalent before any work, measured with `claude -p`.
- On Pro and standard Team seats with extra usage off, the model lock and the
  profile's `availableModels` leave Fable out.
- The Fable note adds Anthropic's instruction to edit files surgically rather
  than rewrite them.
- The output style asks for:
  - dotclaude agents over `general-purpose`
  - briefs sized to finish well inside an agent's turn limit
  - a fresh agent briefed from the handoff report, not a resume, when an
    agent stops at its turn limit
  - a handoff or compaction once the main context passes about 400k tokens
- Codex plans are grouped by quota:
  - Pro 5x and the $100 self-serve Business plan review with Astra.
  - Team, Standard Business, Enterprise, and Edu get the Plus rules: Sol
    reviewer, no Astra.
  - Free and Go do not delegate to Codex.
  - The GPT-5.6 models stay out of the defaults, since they cost about twice
    the credits of their GPT-6 counterparts.

## [0.4.0] - 2026-09-26

Requires Claude Code v2.1.283 or later. After updating:

1. Restart Claude Code.
1. Re-run `/dotclaude:apply-settings-profile` for the feedback settings, the
   `AskUserQuestion` deny, and the new global `CLAUDE.md` block.
1. If you use the Codex agents, re-run `/dotclaude:setup-integrations codex`.

`docs/evals.md` reports what the eval suites show for this release, and what
they do not.

### Added

- Settings profile turns feedback off: `DISABLE_FEEDBACK_COMMAND`,
  `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`, and `DISABLE_ERROR_REPORTING`. This
  removes the SendFeedback tool from every request. Telemetry stays on, because
  turning it off also stops the feature-flag fetch that the advisor tool and
  large-paste marking need.
- Settings profile denies `AskUserQuestion`, about 4.9 KB per request.
- Reproduce before fixing: the output style and the SubagentStart conventions
  treat a reported bug, and any cause it names, as unconfirmed until a minimal
  reproducible example (MRE) shows it. The MRE and its output go in the report;
  a report that does not reproduce is answered with the MRE tried and no code
  change. When the MRE shows a different cause than the one named, Claude fixes
  the confirmed cause and says the named one was wrong.
- Confirmed bugs get fixed: a real bug found along the way, confirmed with an
  MRE, is fixed minimally even though nobody asked, and reported separately
  with its MRE. A large fix, or one that changes behavior callers may rely on,
  is reported instead. Unreproduced suspicions, cleanups, and performance
  concerns stay follow-ups. This applies to questions too: when the answer to
  "why does this fail?" confirms a bug, Claude fixes it without waiting to be
  asked.
- Code items (identifiers, paths, commands, flags, environment variables,
  config keys, values) go in single backticks, in replies and in dotclaude's
  own prompts.
- Eval cases for the output style, agent routing, and subagent dispatch:
  `blunt-message`, `question-confirmed-bug`, `scope-follow-up`,
  `commit-own-files`, `finish-without-offer`, `check-flag`, `review-routing`,
  `surgical-edit`, `delegated-report`, `false-alarm`, and
  `missing-peer-dependency`. The bug-fix cases
  also check that the failure was reproduced before the first edit.
- `evals-heldout/`: 30 cases written by `claude -p --safe-mode` sessions that
  saw only the failure dossiers and Reddit exports, never dotclaude's prompts,
  and frozen in a commit before any agent ran against them. About a third are
  cases where caution is the wrong answer. Its README states when a case may
  change.
- `evals/report.mjs`: summarizes a `claude plugin eval --json` result as trials
  passed per case with 95% Wilson intervals, pass^k, a suite mean with standard
  errors clustered by case, and the paired difference with and without the
  plugin, following Anthropic's statistical guidance for evals.
- `docs/evals.md`: how both eval suites were built, the 0.4.0 results with
  their intervals, what they do not show, and what the next round needs.
- `docs/claude-code-prompt-surface.md`: what Claude Code 2.1.283 sends per
  request, what each customization lever changes, and `policyHelper` output
  fields the docs do not cover.

### Changed

- Shorter prompts with the same rules: the output style, agent and skill
  descriptions and bodies, the SubagentStart conventions, and the global
  `CLAUDE.md` section. Rules that Claude Code's own prompt or tool descriptions
  already send, and rules the SubagentStart text already gives an agent, are
  no longer repeated. The output style's closing `<tone_preference>` line is
  gone.
- The global `CLAUDE.md` section has no heading of its own; the script adds a
  `# CLAUDE.md` top-level heading when the file has none.
- Markdown headings use capitalized words.
- `wrong-diagnosis` eval: expects the reproduced cause in `sum()` fixed and
  `format()` left alone, instead of one exact fix.
- `scope-follow-up` eval: expects the second bug fixed after an MRE and
  reported separately.
- `handoff-note` eval: the prompt carries a session's goal, state, decisions,
  and open items, so no section is legitimately empty.

### Fixed

- Stop gate: a reply that mentioned an error or failure it had fixed ("fixed
  the parser error") counted as admitting the change was unverified, so an
  edit with no check after it ended the turn unchallenged. Only an explicit
  "not run" or "unverified" statement counts now. When the gate sends Claude
  back, it also asks for the complete report again, since that reply replaces
  the earlier one as the report.
- Edit guard: removing test assertions no longer asks when the user's latest
  message asks for tests to be removed ("rip it out: the flag, its tests, all
  of it"). Found by the held-out suite, where the ask, unanswerable in a
  non-interactive run, left a requested deletion half done in 2 of 5 runs.
  Adding a skip marker still asks.
- CloakBrowser launcher: `cloakbrowser` declares `playwright-core` as an
  optional peer, so neither `bun install -g cloakbrowser` nor Bun's
  auto-install fetched it and the launcher failed with "Cannot find package
  'playwright-core'". The launcher now loads the global install and, when
  `playwright-core` is missing there, installs it and restarts itself. The
  install instructions name both packages.
- `recognize-captcha` frontmatter is valid YAML (its description is quoted).

## [0.3.0] - 2026-09-26

Requires Claude Code v2.1.283 or later. After updating:

1. Restart Claude Code.
1. Re-run `/dotclaude:apply-settings-profile`.
1. If you use the Codex agents, re-run `/dotclaude:setup-integrations codex`.

### Added

- Effort cap: the settings profile sets `maxEffortLevel: "xhigh"`, so `max` is
  unavailable to the session, agents, skills, and workflow stages. The claude.ai
  effort picker warns that `max` uses about 5.5x the usage on Opus 5.5 and 3.5x
  on Fable 5.1.
- Workflow bounds in the settings profile:
  - `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=6`, a hard cap per run;
  - `workflowSizeGuideline: "medium"`, advice to aim for fewer than 10 agents.
- `$schema` in the settings profile.
- `install-managed.mjs`: an optional lock you run with `sudo` in your own
  terminal.
  - It writes `managed-settings.d/50-dotclaude.json` with the effort cap, fast
    mode off, and the model list.
  - It never touches `managed-settings.json`.
  - It validates before moving the file into place, asks before replacing a
    different one, and keeps backups outside the drop-in directory.
- `/dotclaude:<skill>` now works anywhere in a message. When it is not at the
  start, a UserPromptSubmit hook injects the skill with the rest of the message
  as `$ARGUMENTS`. For a skill that must run as a command, the hook tells Claude
  how to start it instead.
- A PostModelSwitch hook gives the Fable 5.1 note to a session that switches to
  Fable mid-session, and retracts it on switching away. The session-start note
  alone missed those sessions, since the `model` field is not always present
  there.
- Codex prompt replacement: `/dotclaude:setup-integrations codex` builds three
  model catalogs, `dotclaude-catalog-{interactive,worker,review}.json`.
  - The model list comes from `codex debug models`, run under a temporary Codex
    home that links to your login. A catalog stops Codex from refreshing its own
    list, and this way re-running setup picks up new models. When the fetch
    fails, `models_cache.json` is the fallback.
  - For GPT-6 Astra, Sol, and Luna, dotclaude's templates replace the built-in
    18–21 KB instructions, and the persistent-mode and multi-agent role text is
    removed.
  - `config.toml` and each dotclaude profile point at their own catalog through
    `model_catalog_json`.
  - Both profiles set `include_collaboration_mode_instructions = false` and
    `include_apps_instructions = false`.

### Changed

- CodeGraph prompt context is a lightweight dotclaude hook, on with
  `codegraph_hint`.
  - It replaces `codegraph prompt-hook`, which injects up to 9 KB of explored
    source on any prompt containing a word such as "how" or "call", including
    task notifications and subagent hand-backs.
  - For prompts you type, it looks up the code-shaped names in them (camelCase,
    snake_case, `name(`, `a.b`) with `codegraph query`, and lists only those the
    index has, as name, kind, and file:line. Claude calls `codegraph_explore`
    for the source when it needs it.
  - The setup skill tells you to remove the global `codegraph prompt-hook` entry
    that `codegraph install` adds.
- `web-researcher` runs on Opus 5.5 at low effort, with `maxTurns` 60, instead
  of Haiku 4.5.
  - It backs every "exists" or "doesn't exist" claim with the source line it
    read.
  - It fetches raw pages instead of relying on WebFetch summaries.
  - It reports as soon as the question is answered.
- `recap`, `challenge`, `blind-spots`, and `lessons-learned` can be loaded by
  Claude when you ask for what they do. `polish`, `troubleshoot`, `fresh-eyes`,
  `review-code-changes`, and `apply-settings-profile` still run only when you
  name them.
- Output style:
  - A correction is answered with the corrected fact or changed action. The
    quoted banned phrase is gone, because quoting it primed it.
  - The line before the first tool call names what is being done to your task,
    not how tools or skills load.
  - Ending a turn with a question is kept for questions whose answer changes the
    next step.
  - New guidance on continuing a subagent that stopped at its turn limit, and on
    cheap `agentType` and `effort` choices in workflow scripts.
  - The style is no longer than before.
- The session-start staleness notice also checks for the effort cap. It looks at
  user, project, and local settings and at managed settings and their drop-ins.
- The Codex worker profile drops `compact_prompt`, which has no effect with
  remote compaction on GPT-6. Its `developer_instructions` now match the worker
  template: assumptions are listed instead of stopping to ask.
- The verify-before-stop gate counts `bun run validate` (and other package
  managers' `validate` scripts), `claude plugin validate`, and `markdownlint` or
  `markdownlint-cli2` as check runs.
- The Codex load check runs `codex -p <profile> debug prompt-input` for both
  profiles.
- `bun test ./tests/` replaces `bun test tests/` in `package.json` and CI. The
  bare form is a path filter that also picked up tests under ignored
  directories.
- The Markdown passes markdownlint. The shared rules moved to
  `.markdownlint.jsonc`. Prompt files in `agents/`, `skills/`, `output-styles/`,
  and `evals/` are exempt from the 80-column limit and keep their step numbers.
  Two skills had a code fence directly after an XML tag, which Markdown read as
  part of the tag; a blank line now separates them.

### Removed

- The `codegraph_prompt_context` option, which ran `codegraph prompt-hook` on
  typed prompts. Its replacement is below under Changed.
- `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` from the settings profile. Claude Code
  removed it in v2.1.224, and it has no effect. Re-applying the profile removes
  it from settings an earlier version wrote it to.

### Fixed

- The stop gate counted any quoted string in inline interpreter code as an
  edited file.
  - A regex literal, or a file the script only read, was recorded as an edit and
    triggered "Code changed … no test ran".
  - Now only the path argument of an actual write call is recorded, and paths
    after a `cd` resolve against that directory.
- The guard tests failed inside a session with the dotclaude profile applied,
  because `ANTHROPIC_DEFAULT_SONNET_MODEL` leaked into alias resolution. The
  tests now clear the model alias variables.

## [0.2.0] - 2026-09-26

Requires Claude Code v2.1.283 or later. After updating, restart Claude Code and
re-run `/dotclaude:apply-settings-profile`.

### Added

- Sixteen agents, each with its effort set in its file:
  - Opus 5.5 at high effort: `security-reviewer`, `plan-reviewer`, `debugger`,
    `performance-engineer`.
  - Opus 5.5 at medium effort: `implementer`, `test-writer`, `ci-investigator`,
    `dependency-auditor`.
  - Opus 5.5 at low effort: `mechanical-worker` (in place of Sonnet),
    `test-runner`, `docs-writer`, `history-investigator`.
  - Haiku 4.5: `web-researcher`, `integration-setup`, `codex-worker` (forwards
    to GPT-6 Luna), `codex-reviewer` (forwards to Astra on Pro plans, Sol on
    Plus).
- Skills you run yourself, which cost no context until invoked: `recap`,
  `challenge`, `blind-spots`, `troubleshoot`, `fresh-eyes`, `polish`, and
  `lessons-learned`.
- `setup-integrations` skill: checks, installs, and configures CodeGraph,
  Headroom, and the Codex CLI through the Haiku `integration-setup` agent. Ask
  in plain words ("set up headroom") or run `/dotclaude:setup-integrations`.
- Codex profiles, installed by `/dotclaude:setup-integrations codex` as
  `$CODEX_HOME/<name>.config.toml` files that inherit `config.toml`:
  - `dotclaude-luna`: a bounded worker on GPT-6 Luna at high effort, with a
    workspace-write sandbox, no approvals, and subagents, goals, apps, browser
    use, and the skills catalog off.
  - `dotclaude-review`: a read-only reviewer on Astra for Pro plans and Sol for
    Plus.
- The Codex setup also sets `service_tier = "default"` and fast mode off in
  `config.toml`, and on Plus pins the base model to Luna.
- `codex-fanout` skill: runs a large, well-specified job as a queue of small
  items on parallel Luna workers sized to the ChatGPT plan. Claude reviews and
  commits the results.
- The Codex plan (`plus`, `prolite`, `pro`) is read from the `chatgpt_plan_type`
  claim of the Codex login; tokens never leave the helper.
- Stop gate on `SubagentStop`, checked against the subagent's own edits and
  check runs.
- Files written through Bash now count as edits: redirects, `tee`,
  `sed -i`/`perl -i`, `sd`, `mv`/`cp` targets, and interpreter code that writes
  a file it names inside the project.
- Compaction carry-over lists uncommitted files in two groups: those this
  session or its subagents edited, and the rest, which may be the user's and are
  not to be reverted.
- Session-start notes:
  - Fable 5.1's adjustments to the Opus-tuned output style, on Fable sessions
    only.
  - Non-default browser and CAPTCHA options, which plugin options cannot pass to
    skills directly.
  - A notice when the settings profile is out of date or
    `CLAUDE_CODE_EFFORT_LEVEL` is set.
- Options:
  - `ask_in_auto_mode`: ask about recoverable actions even in auto mode.
  - `allowed_codex_models`: the Codex models a `codex` command may name.
  - `codegraph_prompt_context`: runs `codegraph prompt-hook` for prompts you
    type, skipping background-task notifications and subagent hand-backs.
- Settings profile additions:
  - Haiku 4.5 in `availableModels`, and as `ANTHROPIC_DEFAULT_HAIKU_MODEL` for
    background tasks.
  - The `sonnet` alias mapped to Opus 5.5.
  - `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, because the task-list tools are off by
    default on Opus 5.5.
  - `ultracode: false`.
  - Pre-approval for `codex exec -p dotclaude-luna *` and
    `codex exec -p dotclaude-review *`.
- Read-only agents can call `mcp__codegraph__codegraph_explore` and
  `mcp__headroom__headroom_retrieve`.
- The CloakBrowser launcher accepts `--no-humanize` and `--no-geoip`.

### Changed

- Recoverable actions ask only in attended permission modes; in auto mode the
  auto mode classifier decides them. These actions are deleting git-tracked
  files, `find`/`fd` deletes, inline code that deletes files, generated-file and
  lockfile edits, and a Write that drops most of a long file.
- The output style, every agent, the injected subagent guidance, and the skills
  are rewritten to Anthropic's prompting structure for Opus 5.5: XML-wrapped
  prose sections, a reason for each rule, calm wording, and a closing
  `<tone_preference>`.
- New output-style rules:
  - a sanity check instead of answering from memory;
  - debugging by measurement;
  - challenging a proposed approach before building on it;
  - a shared working tree with the user;
  - using credentials the user points to without printing them;
  - re-checking state after compaction;
  - keeping the task list true;
  - a small main context without self-verification subagents.
- Narration follows a cadence (one line before the first tool call, then updates
  only for findings, blockers, and changes of direction) instead of a ban on
  text between tool calls.
- Reviewers report every finding with a severity and a confidence, and are meant
  for requested or large, risky changes.
- Agents that edit never stash, check out, restore, reset, or bisect in the
  shared tree.
- Model policy:
  - Haiku 4.5 is allowed by default.
  - An explicit Sonnet model is denied, with a pointer to `mechanical-worker`.
  - The concurrent-subagent cap rises from 4 to 6.
- The settings profile replaces the model policy instead of merging it:
  `availableModels`, and any `Agent(model:...)` deny it does not carry.
- `drive-web-browser` gains a `when_to_use` trigger. The global CLAUDE.md
  section no longer lists browser CLIs, and adds the credential and sanity-check
  rules.
- `mktemp` handling in the Bash guard: `S=$(mktemp -d)` with no directory
  argument resolves as a temp path.

### Removed

- The `Agent(model:sonnet*)`, `Agent(model:haiku*)`, and
  `Agent(model:claude-haiku*)` denies from the settings profile.
- The blanket "write nothing between tool calls" instruction for subagents.

### Fixed

- About 150 of the 188 prompts recorded in real auto-mode sessions were false
  positives:
  - `S=/tmp/x; rm -rf $S` now resolves `$S` when it is assigned once to a
    literal value. Reassignment, `read`, `unset`, `for`, `eval`, `IFS`, and
    values with whitespace keep it unresolved.
  - `__pycache__`, `*.pyc`, and other cache cleanups through `find` or `fd` no
    longer ask. This applies only when the match itself is the only thing
    deleted.
  - `env -u X swift test` inside a loop is no longer read as a snapshot update.
  - `gh … --help` is no longer treated as a GitHub write.
  - `git worktree remove --force` asks only when the worktree has uncommitted
    changes.
  - Skip markers in a new test file no longer count as weakening tests.
- The CloakBrowser launcher crashed on `--no-humanize` and `--no-geoip`.
- The `cloakbrowser`, `cloakbrowser_headless`, `cloakbrowser_humanize`, and
  `captcha_ocr_ddddocr` options had no effect.
- `drive-web-browser` referred to a `browser_backend` option that does not
  exist.

### Security

- Commands after shell keywords (`if …; then rm -rf /; fi`, `do`, `else`,
  `while`) were not checked by the Bash guard.
- `codex` commands:
  - `--dangerously-bypass-*` flags are denied.
  - Turning Codex fast mode or the priority tier back on is denied.
  - Models outside `allowed_codex_models` are denied.
  - GPT-6 Astra is refused on the ChatGPT Plus plan, whether it is set by `-m`,
    by a `-p` profile, or by the base config.

## [0.1.0] - 2026-09-25

### Added

- Bash guard, edit guard, verify-before-stop gate, compaction carry-over, and
  fast-mode and model lock hooks.
- The dotclaude output style, forced on while the plugin is enabled.
- The `code-reviewer` agent.
- The `apply-settings-profile`, `review-code-changes`, `write-session-handoff`,
  `drive-web-browser`, and `recognize-captcha` skills.

[unreleased]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.8.1...HEAD
[0.8.1]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.8.0...dotclaude--v0.8.1
[0.8.0]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.7.0...dotclaude--v0.8.0
[0.7.0]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.6.2...dotclaude--v0.7.0
[0.6.2]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.6.1...dotclaude--v0.6.2
[0.6.1]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.6.0...dotclaude--v0.6.1
[0.6.0]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.5.1...dotclaude--v0.6.0
[0.5.1]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.5.0...dotclaude--v0.5.1
[0.5.0]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.4.0...dotclaude--v0.5.0
[0.4.0]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.3.0...dotclaude--v0.4.0
[0.3.0]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.2.0...dotclaude--v0.3.0
[0.2.0]:
  https://github.com/xsyetopz/dotclaude/compare/8677d10...dotclaude--v0.2.0
[0.1.0]: https://github.com/xsyetopz/dotclaude/commit/8677d10
