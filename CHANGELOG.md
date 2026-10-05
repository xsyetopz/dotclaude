# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

### Changed

- The documentation moved to the [GitHub wiki](https://github.com/xsyetopz/dotclaude/wiki).
  The page source is in `wiki/`, and `just wiki` publishes it.
  `docs/README.md` now only links to the wiki pages.
- The release archive of 0.1 to 0.19 is now one consolidated wiki page for each release line, with [Release History](https://github.com/xsyetopz/dotclaude/wiki/Release-History) as its index.
- The external sources of the old `docs/external/` are now in `external/`, which git ignores.

## [0.20.5] - 2026-10-05

### Fixed

- The Context7 rate-limit check in `/dotclaude:setup` reads the status and the tier correctly.
  Context7 refuses a key that is not valid with `HTTP/2 401`, and it can show `context7-quota-tier: anonymous` for a valid key.
  Before, setup told the user that the key was not valid when the tier was `anonymous`.
  Setup also asks for a key only when `CONTEXT7_API_KEY` is not set.
- `/dotclaude:setup` suggests each curated LSP plugin of the `claude-plugins-official` marketplace whose language server is on `PATH`.
  It reads the plugins from the marketplace manifest, so a new curated plugin shows with no dotclaude release.
  Before, a fixed table of 6 plugins left out `csharp-lsp`, `jdtls-lsp`, `kotlin-lsp`, `lua-lsp`, `php-lsp`, and `ruby-lsp`.
  For an installed plugin that is disabled, setup gives `/plugin enable`.
  Before, setup counted an installed plugin as done, also when it was disabled.

## [0.20.4] - 2026-10-05

### Added

- Each compaction note marks the earlier compaction note of the same session as `superseded`, because the new note carries its open items.
  Before, each compaction left one more `in-progress` note.
- The CodeGraph augment: when a `Grep` call or a Bash `rg` or `grep` search looks for one symbol name in a project with `.codegraph/`, the hooks module adds the callers and callees of that symbol to the search result.
  Claude ignored rules that told it to run `codegraph`, so the graph now comes with the search that Claude already runs.
  The design follows the GitNexus hooks.
  Before a lookup, the hook runs `codegraph sync` if files changed since the last index, because without the MCP server the index does not update itself.
  It never builds an index.
  The plugin option `codegraph` turns it off.
- The minimal-code rules: session start tells Claude to build the minimum, with the idea of Ponytail.
  The plugin option `ponytail` turns them off.
- Usage habits in the working rules: a handoff note and `/clear` at a task boundary, `/btw` for a side question, a lower effort in place of a model change, and a model change only after `/clear`.
- Line breaks in the working rules: in Markdown, comments, commits, and PRs, Claude starts each sentence on a new line and does not break lines at a column, as in [Semantic Line Breaks](https://sembr.org/).
  Claude hard-wrapped prose at about 80 columns, which breaks reflow in editors and terminals and makes diffs larger.
  A project style takes precedence.
  Shorter wording of the other rules keeps the file within its 2,000-byte bound.
  Claude Code 2.1.289 has no `CLAUDE_NO_WRAP` variable or `--no-word-wrap` flag, and a plugin cannot change how the terminal wraps output.
- The profile sets `cleanupPeriodDays` to 14, `enableArtifact` to `false`, `disableBundledSkills` to `true`, and `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS` to `1`.
- `/dotclaude:setup` keeps the newest 3 backups of each file and deletes the older ones.
  It lists the memory files to review and the LSP plugins for the language servers on `PATH`.
- The setup integrations reference covers the LSP plugins and the `ctx7` CLI for library docs, with no MCP server.
  The `web-researcher` agent uses `ctx7` when it is on `PATH`, because it uses less context than a web search.
  When `ctx7` is rate-limited, the agent checks the limit with one call and uses `WebSearch` and `WebFetch` until the reset.
- `/dotclaude:setup` gives the command that adds a Context7 API key to the shell profile.
  The user runs it outside Claude Code, and setup then checks that the key gives a tier other than `anonymous`.
- The optional `dotclaude-jev` plugin: its `second-opinion` skill asks TypeSafe Jev, a decision model, for a yes or no check, a pick from options, or a rating, with a probability for each answer.
  Claude uses it for its own close calls, and still asks the user the questions that only the user can answer.
  It also checks a technical decision of the user: when Jev finds that facts decide it and that it causes defects, Claude tells the user the facts once and asks for a confirmation, and the answer of the user is final.
  It needs `TYPESAFE_API_KEY`.
- The README has a "Save weekly usage" section, and the dossier ranks the community claims about usage.

### Changed

- Plugin, agent, and skill descriptions and hook messages put code items in backticks.

### Fixed

- The verify gate no longer asks for a check after an edit to a file outside the project, such as a plan file in `~/.claude/plans/`.
- The verify gate no longer counts an edit that failed, such as a `Write` that a permission denied.
  Before, a denied `Write` sent Claude back for a check of a change that did not occur.
- Setup keeps a status line of another tool, and tells you how to replace it with `--status-line`.
  Before, it replaced the status line without a question.
- A resumed session with an expired cache and less than 100k tokens of context no longer gets the cold cache notice, as in 0.19.
  The cache write of a small context costs little.
- The handoff pointer and the compaction note tell Claude to set a note to `done` only when each item in its Open section is done.
  Before, the pointer said to close a note when "the work" was complete, and an agent closed a note whose Open list still had items.

## [0.20.3] - 2026-10-04

### Changed

- A status line group of one part shares its row with the next group.
  Thus the model does not stand alone on the first row when the context and the cache are not known yet.
- The status line code is in modules with one job each: `paint.mjs` (icons, colors, bars), `format.mjs` (model names, times, money), `parts.mjs` (one function for each part), `layout.mjs` (rows), and `render.mjs` (both status lines).
  `shared.mjs` is gone.

### Fixed

- The status line stubs that `/dotclaude:setup` writes run the newest plugin version in the plugin cache.
  Before, they ran the version that was current at setup, so a plugin update did not change the status line until setup ran again.

## [0.20.2] - 2026-10-04

### Changed

- The status line has one row for each topic.
  The first row is the session: model, context, and cache expiry.
  The second row is the usage: each window, limit resets, and extra usage.
  The third row is the place, and then the detail: cache hit ratio, cost, lines, and time.
- Each usage window shows its deficit or reserve in its own part, as `7d █████  99% ▲16%→3:41am ↻Oct 5 at 7am`.
  A pace thus never shows without its window, and it drops only with its window.
- The cache hit ratio reads as `hit 96%`.
  Before, it had the `◷` icon of the cache expiry.
- A blinking `⚠` shows dim in its off frame.
  Before, a blank space showed, and it looked like a gap after the separator.

### Fixed

- A date and time in the status line read as `Oct 12 at 4am` on all systems.
  Some ICU versions, as on Linux and Windows, joined them as `Oct 12, 4am`, and the test failed there.
- The 7d deficit or reserve did not show in a narrow terminal, also while the 7d window was past the first usage level.
  The 5h pace could also show without its window.

## [0.20.1] - 2026-10-04

### Added

- The status line shows the limit resets that you can use, as `⟳2 by Oct 12 at 4am`: the count and the earliest expiry.
  It reads them from the `cedar_ember` block of the `/usage` copy that Claude Code keeps in `.claude.json`, so it makes no network call.
  A grant counts when it is not paused, has resets left, and is in its start to end span, as in Claude Code and CodexBar.
  While a usage window is at its limit, the reset part outranks the other parts.
- The status line shows the extra usage spend while extra usage is on, as `extra █░░░░ $12.50/$50`, or `extra $12.50` with no monthly limit.
  It reads `extra_usage` from the same copy.

### Changed

- The status line reads the `/usage` copy on each run, not only when the status JSON has no usage windows.
  The windows of the status JSON still have priority.

## [0.20.0] - 2026-10-04

0.20.0 is a full reset on Claude Code 2.1.289.
It keeps the parts that serve a need that Claude Code does not cover, and it removes the rest.
Runtime JavaScript goes from 18,935 lines in 0.19.1 to 2,118 lines, and `tests/budget.test.mjs` bounds it at 3,000.
Run `/dotclaude:setup` again after you update.

### Added

- `docs/parts.md`, a page that lists each part, its event, its bound, and the need that it serves.
- The rule that runtime JavaScript (`hooks/`, `status-line/`, `skills/`, `plugins/`) stays within `RUNTIME_JS_LINES` (3,000) in `hooks/lib/_budget.mjs`.
  0.19.1 had no bound on it, and its runtime JavaScript grew to 18,935 lines, much of it a copy of what Claude Code 2.1.287 to 2.1.289 does itself.
- The plugin options `guard_agents` and `compaction_handoff`.
  `guard_agents` turns off the spawn rules, and `compaction_handoff` turns off the handoff fork.
- A Stop verify gate.
  It sends Claude back once when a turn edited files and no check ran after the last edit, because the usage evidence shows that a rule in a prompt does not hold and a hook does.
  It finds the check from the `justfile`, `package.json`, or `Makefile` of the project.
- A compaction instruction.
  The summary says that an unapproved plan or an open question stays open, because the default summary text tells Claude to continue without asking, and a model then acted on a plan that the user had not approved.
- A handoff fork on compaction.
  Before a compaction of the main conversation, a fork writes a handoff note to `.claude/handoffs/` and adds it to the compacted conversation, because users report that a handoff note beats a compaction.
  If the fork gives no note in 60 seconds, the compaction runs without it.
- Cold-cache notes.
  A resumed session with an expired prompt cache, and a prompt that comes more than 1 hour after the last turn, give Claude the cost advice, because 1.6% of the turns, those after more than 1 hour idle, caused 80% of the cache writes.
- Plan detection from the account in `.claude.json`, in `hooks/lib/_plan.mjs`.
  The cold-cache note uses a 5 minute cache time on the `api` plan and 1 hour on other plans.
  A new or cleared session on the `api` plan gets a plan note.
  `skills/setup/scripts/settings.mjs` shows the plan, takes `--plan <id>`, and applies the profile's per-plan `plans` overrides.
- A status line with every 0.19 part, in less code, where each part has one shape: icon, bar, number.
  One bar renderer, one icon set, and one color scale (`USAGE_LEVELS`) serve every percentage.
  The rows are `core` (model, context, cache, limits), `place` (folder, branch, worktree, PR, loop), and `detail` (cache hit ratio and misses, limit pace, cost).
  A `⚠` blinks for a handoff due (context at 90% of the compaction point), a cache that expires in two minutes or less, and a limit at 90%.
  `⚠` also marks an effort that the rules do not allow for the model.
  A second script shows the model and context of each running agent.
  `/dotclaude:setup` writes two stubs in the config directory and sets `statusLine` and `subagentStatusLine` to run them, because a status line command gets an empty `${CLAUDE_PLUGIN_ROOT}`.
- The `backend` option of `dotclaude-browser`, which defaults to `agent-browser`.
  The value `cloakbrowser` runs `agent-browser` with the CloakBrowser binary through `--executable-path`, for sites with bot detection.

### Changed

- **Model and effort rules.**
  Opus 5.5 takes `low`, `medium`, and `high`, Sonnet 5.5 takes `low` and `medium`, and Haiku 4.5 takes no effort.
  `agent.spawn` denies a spawn that breaks the table, and `tests/agents.test.mjs` keeps the agent files in step with it.
  The status line warns about the main session, because no hook event fires when its effort changes.
- `reviewer` and `debugger` run at `medium`, from `high`.
  In the 0.17.1 eval rerun, Sonnet 5.5 at `medium` passed 109 of 110 at $0.10 for each pass, and at `high` it passed 107 of 110 at $0.12.
- The settings profile sets `maxEffortLevel` to `high`, from `xhigh`, because the rules above allow no effort over `high`.
- The Bash, Edit, and secret guards are small.
  They are 3 files with 367 lines in place of 14 files with 4,428 lines, and they keep the asks for hard-to-undo commands, test deletion, generated files, and settings files, and the Betterleaks redaction.
  The large rule sets (infrastructure, search, TLS, dependencies, proof escapes, and AI policy) go, because the auto-mode classifier and the permission rules of Claude Code cover them.
- The working rules in `hooks/session-start/rules.md` are 1,442 bytes, from 4,300 bytes in 0.19.1, and a test bounds them at 2,000.
  A standing prompt costs on every turn.
- `/dotclaude:setup` applies one profile (`recommended.json`) with one script, `settings.mjs`, in place of the 0.19 profiles and scripts.
  The preview shows each setting that differs, and a second run changes nothing.
- The only output style is `Concise`, because Claude Code has the other styles built in.
- `drive-web-browser` uses `agent-browser` by default, because it needs no extra binary, and CloakBrowser is an opt-in for sites with bot detection.
- The status line bounds live only in `hooks/lib/_budget.mjs`, and `status-line/shared.mjs` imports them.
- `refreshInterval` is `STATUS_REFRESH_SECONDS` (1) in `hooks/lib/_budget.mjs`.
  Slow reads (`git status`, the compaction count, the `/usage` copy) run once per `STATUS_CACHE_MS` (5 s) and not on each run, where 0.19 ran them on each run.
- `scripts/usage-report.mjs` runs again with its own helpers in `scripts/_usage-lib.mjs`.
- Each agent file has `maxTurns` (20 to 80), in place of the 0.19 budget hooks, because the setting bounds an agent with no hook.
  `implementer` takes the bulk changes of `mechanical-worker`.

### Removed

- The delegation gate and note, because users report cost blow-ups from subagents and `maxTurns` bounds an agent without it.
- The agent budget hooks (`enforce-agent-budget`, `hand-off-capped-agents`, and the report caps), because the `maxTurns` of an agent file does the same job.
- The model-switch, `ConfigChange`, `StopFailure`, and `TaskCompleted` hooks, because `availableModels` and `CLAUDE_CODE_DISABLE_FAST_MODE` do the same job.
- The options `model_lock`, `model_plan`, `model_allowed`, and `usage_notes`, and the other 0.19 options except the guard options, because the hooks that they controlled are gone.
- Fable 5.1 from `availableModels` and from the `Agent(model:fable*)` deny rule, because the user chose to remove it, and a subagent never runs on it.
- Nested instructions (`load-nested-instructions`), because Claude Code 2.1.288 loads rules on Write and Edit.
  A Bash read of a directory does not load its `CLAUDE.md` yet.
- The restore after a compaction, the check for line breaks, and the scratchpad pruning, because the 0.20.0 review found no need for them that Claude Code does not cover.
- `warn-instruction-size`, because `/doctor` audits the instruction files.
- The skills `slices`, `explain`, and `polish`, because `/goal` covers a large change, and the 0.20.0 review found no need for the other two.
- The agent `mechanical-worker`, because `implementer` does its work.
- The output styles `Explanatory`, `Learning`, and `Proactive`, because Claude Code has built-in styles of those names.
- The `recognize-captcha` skill and the CloakBrowser launcher, because CloakBrowser keeps most CAPTCHAs away and `agent-browser --executable-path` runs its binary.
- The AI policy catalog and its update script `scripts/update-ai-policies.mjs`, and `scripts/count-tokens.mjs`, which served features that 0.20.0 removed.
  The `contribute` skill still reads the policy of the project.
- The eval case `t4-slices`, because it tests the removed `slices` skill.
- The 0.19 profile `optional.json`, the setup scripts for migration and the managed lock, and the public docs pages for the removed parts.

### Fixed

- A model strip defect: `prefer-dotclaude-agents` removed the `model` that a spawn call gave, so the agent ran on another model than the call asked for.
  `agent.spawn` now denies a `model` that is not the one that the agent file fixes, and the reason names the fixed model.
- `scripts/usage-report.mjs` runs again.
- `just sandbox` applies the setup profile and the status line again.
  It ran the deleted `apply-statusline.mjs` and hid the error.

## Older Releases

| Series | Releases |
| --- | --- |
| [0.19](https://github.com/xsyetopz/dotclaude/wiki/Release-0.19) | 0.19.1, 0.19.0 |
| [0.18](https://github.com/xsyetopz/dotclaude/wiki/Release-0.18) | 0.18.1, 0.18.0 |
| [0.17](https://github.com/xsyetopz/dotclaude/wiki/Release-0.17) | 0.17.1, 0.17.0 |
| [0.16](https://github.com/xsyetopz/dotclaude/wiki/Release-0.16) | 0.16.1, 0.16.0 |
| [0.15](https://github.com/xsyetopz/dotclaude/wiki/Release-0.15) | 0.15.1, 0.15.0 |
| [0.14](https://github.com/xsyetopz/dotclaude/wiki/Release-0.14) | 0.14.1, 0.14.0 |
| [0.13](https://github.com/xsyetopz/dotclaude/wiki/Release-0.13) | 0.13.1, 0.13.0 |
| [0.12](https://github.com/xsyetopz/dotclaude/wiki/Release-0.12) | 0.12.1, 0.12.0 |
| [0.11](https://github.com/xsyetopz/dotclaude/wiki/Release-0.11) | 0.11.1, 0.11.0 |
| [0.10](https://github.com/xsyetopz/dotclaude/wiki/Release-0.10) | 0.10.2, 0.10.1, 0.10.0 |
| [0.9](https://github.com/xsyetopz/dotclaude/wiki/Release-0.9) | 0.9.0 |
| [0.8](https://github.com/xsyetopz/dotclaude/wiki/Release-0.8) | 0.8.2, 0.8.1, 0.8.0 |
| [0.7](https://github.com/xsyetopz/dotclaude/wiki/Release-0.7) | 0.7.0 |
| [0.6](https://github.com/xsyetopz/dotclaude/wiki/Release-0.6) | 0.6.2, 0.6.1, 0.6.0 |
| [0.5](https://github.com/xsyetopz/dotclaude/wiki/Release-0.5) | 0.5.1, 0.5.0 |
| [0.4](https://github.com/xsyetopz/dotclaude/wiki/Release-0.4) | 0.4.0 |
| [0.3](https://github.com/xsyetopz/dotclaude/wiki/Release-0.3) | 0.3.0 |
| [0.1 and 0.2](https://github.com/xsyetopz/dotclaude/wiki/Release-0.1-0.2) | 0.2.0, 0.1.0 |

[unreleased]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.20.5...HEAD
