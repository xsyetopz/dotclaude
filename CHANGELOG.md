# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

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
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.2.0...HEAD
[0.2.0]:
  https://github.com/xsyetopz/dotclaude/compare/8677d10...dotclaude--v0.2.0
[0.1.0]: https://github.com/xsyetopz/dotclaude/commit/8677d10
