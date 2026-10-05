# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

## [0.22.2] - 2026-10-05

### Fixed

- In one week, five subagents stopped at their turn limit, and Claude Code delivered no report from them, so all of their work was lost.
  Clause 15 of the Terms of Use, `Subagent progress`, now gives each subagent a progress file in the temporary folder, named by its agent ID.
  The subagent adds one line to the file after each step.
  This replaces the line in each agent file that told the agent to write its report as it went.
- When an agent stops at its turn limit, the main agent reads the progress file and continues the agent with `SendMessage`, and does not run the done steps again.
  The main agent also gives each agent a task that fits in its turn limit, and gives one subject to each research agent.
- The `test-runner` agent used one `Bash` call for each command of a batch, and three of them stopped at their 20-turn limit.
  It now runs a batch in one `Bash` call, with one log for each command, and reads all failed logs in one more call.
- The Bash guard gave the reason of only the first flagged target of an `rm -r` command.
  In `rm -rf /tmp/a.sh "${TMPDIR}"tmp.*`, the ask said only that the target is outside the project, and the approved command deleted the temporary folders of all programs.
  The ask now gives the reason of each flagged target.

## [0.22.1] - 2026-10-05

### Fixed

- A subagent fetched the code of a project whose AI policy forbids AI tools.
  The main agent knew the policy, but nothing gave it to the subagent, and nothing checked the policy before a read or a fetch.
  Clause 14 of the Terms of Use, `Project AI policy`, now tells the main agent and each subagent to read the `CLAUDE.md`, `AGENTS.md`, and `AI_POLICY.md` of a project of another owner before it reads, clones, fetches, or runs its code.
  A new `SubagentStart` hook gives the clause to each subagent.
- The policy guard (`guard_policy`) asks the user before the first call of a session that reaches a project of another owner with a policy file, and the prompt shows the policy.
  A reach is a GitHub fetch (`git clone`, `gh repo clone`, `gh api`, `curl`, `wget`, or `WebFetch`) or a path in a local clone outside the project.
  The ask comes before the call, so the user sees the policy before any code arrives.
  The guard asks and does not deny.
  It does not cover hosts other than GitHub, for which only the clause applies.
  After a GitHub fetch, Claude also gets the policy text.
- On Windows, the startup note did not name an old or missing status line launcher.
  Setup writes the launcher path as JSON with doubled backslashes, and the check looked for the path with single backslashes.

## [0.22.0] - 2026-10-05

### Added

- `just release` tags all plugins at `HEAD` and pushes the tags in one atomic push.
  Add `--dry-run` to preview the tags.
- At startup, the user gets a notice when the user settings, the `CLAUDE.md` block, or the status line launchers differ from the setup profile.
  The notice recommends `/dotclaude:setup`, and it shows once for each plugin version, so a value that the user keeps on purpose does not show at each start.
  The notice goes to the user only, and adds nothing to the context of Claude.
- A session in a git repository without a CodeGraph index tells Claude to run `codegraph init -y`.
  The Bash guard asks the user before `codegraph init` and `codegraph uninit`.
  This is clause 12 of the Terms of Use, `CodeGraph index`.
  The `codegraph` option turns the note off.
- The `CLAUDE.md` block has a CodeGraph rule: use `codegraph explore` before `grep` or a file read in a repository with an index.
  Setup removes the `CODEGRAPH_START` section of `codegraph install`, after a backup.
- Clause 13 of the Terms of Use, `Long runs`: before a loop over a step of unknown speed, time one run, give each run its own `timeout`, and run long work in the background.
  A foreground loop of slow runs once blocked a session.

### Changed

- The repository has a new layout.
  The core plugin is in `plugins/dotclaude/`, next to `dotclaude-browser` and `dotclaude-jev`.
  Pure rules are in `lib/` (`guards/`, `notes/`, `setup/`), and the setup files are in `templates/` (`CLAUDE.md.block`, `settings.json`, `context/`).
  The tests are in one folder for each plugin, and the repository scripts are in `tools/`.
- In each plugin, `hooks/` has one folder for each hook event, and each script name tells what the script does.
  The hooks module of a plugin is `hooks/module/index.mjs`.
  The core plugin has `hooks/session-start/add-session-context.mjs` and `hooks/pre-tool-use/ask-guarded-calls.mjs`.
  `dotclaude-browser` has `hooks/session-start/add-browser-notes.mjs`, and `dotclaude-jev` has `hooks/session-start/second-opinion.md`.
- At a task boundary with open work, Claude writes or updates a handoff note, and gives `/clear` and a continuation prompt in the same reply.
  Before, Claude only said that it was a good time to run `/clear`.
  No hook enforces this, because only the reply text shows a break, and 0.18.1 removed the reply-text Stop gates.
- A prompt that Claude suggests names each file as `@` and its absolute path, so that Claude Code reads the file at once.
  After an automatic compaction, Claude writes the continuation prompt for the task, with `@` and the path of the note, in place of a fixed text.
- `RULES_MAX_BYTES` is 2,200, up from 2,000, for the handoff and prompt rules.

- The CodeGraph augment builds an index in an old format again with `codegraph index` before a lookup, as it runs `codegraph sync` for changed files.
  The new bound `CODEGRAPH_INDEX_TIMEOUT_MS` is 30 s, because 1,296 files took 5 s.

- The subagent status line shows the context against the compaction point (117k), not against 100k or 150k.
  A subagent compacts at the same point as the main conversation.
  In 914 subagent runs of 7 days, the peak context stopped at about 117k, and 78 of 457 `implementer` runs showed a false warning past 100k.
  `SUBAGENT_CONTEXT_TOKENS` and `REVIEWER_CONTEXT_TOKENS` are removed.
- A status line launcher in the plugin cache has the same text for each plugin version.
  The launcher of 0.21.0 and older also has the script of one version as a fallback, so `/dotclaude:setup` writes it again one time.
  The launchers of 0.21.0 and older also run the status line of 0.22.0, because `status-line/` is at the same place in the plugin folder.

### Fixed

- In auto mode, the Bash and edit guards ask the user again.
  Before, the auto-mode classifier got the ask of the hooks module and allowed the call, so `codegraph init -y` and `git branch -D` ran with no prompt.
  A classic `PreToolUse` hook, `hooks/pre-tool-use/ask-guarded-calls.mjs`, now gives the same ask, and the classifier cannot allow a call that a classic hook asks about.
  The options `guard_bash` and `guard_edit` also turn this hook off.
  The attribution ask of the Bash guard is still in the module only, so auto mode does not show it.
- `dotclaude-jev` no longer has a `tsconfig.json`.
  It extended `.claude-plugin/types/`, which an installed plugin does not get.
  The `tsconfig.json` at the repository root now gives the types to an editor.
- A prompt that Claude suggests after a handoff now puts a path with a space in quotes, as in `@"/a b/n.md"`.
  A space ends a bare `@` path, so Claude Code did not read the note.
  The working rules, the handoff skill, and the prompt after a compaction all use the quoted form.
  The working rules are shorter, so that they stay within `RULES_MAX_BYTES`.

## [0.21.0] - 2026-10-05

### Added

- The edit guard asks before an edit that writes a `[REDACTED:` marker into a file.
  The secret redaction puts this marker in a tool output in place of a value, so an edit from that output can replace the real value.
  In one session, Betterleaks found the RFC 6455 sample nonce in a test file, and the output showed the marker 10 times.
- The line-break hook runs [sembr](https://github.com/admk/sembr) on the prose that Claude writes.
  Before a `git commit`, `gh pr`, or `gh issue` command runs, it rewraps the message with semantic line breaks.
  After a `Write` or `Edit` of Markdown or code comments that break lines at a column, the result gets the `sembr` text.
  The hook never rewrites a file, because a changed file makes the next `old_string` fail to match.
  The line-break check was removed in 0.20.0, and after that the rule alone did not stop Claude from breaking prose at a column.
  The `sembr` option turns the hook off, and the hook does nothing without `sembr` on `PATH`.
  `/dotclaude:setup` offers to install it.

### Fixed

- The Bash guard asks before a `git checkout` or `git restore` of named files, because the command discards their uncommitted changes and git cannot restore them.
  Before, it asked only for the path `.`.
  In one session, Claude ran `git checkout` on a file to undo one small edit, and the command also discarded the uncommitted tests of earlier sessions.
  A branch switch, such as `git checkout main` or `git checkout feature/login`, does not ask, because it keeps uncommitted changes.
- The CodeGraph augment adds a note only for a real definition.
  `codegraph callers` falls back to a text search for a name that is not a symbol, so words such as `token`, `delet`, and `REDACTED` got notes with unrelated callers.
  The hook now runs `codegraph query` first, and it continues only when the index has a function, method, class, or a similar definition with exactly that name.
  The note names the file and line of the definition.
  The new bound `CODEGRAPH_QUERY_LIMIT` sets the number of query results.
- The note for an index from an earlier CodeGraph version names `codegraph index`.
  `codegraph sync` does not clear this state, so the old note sent Claude to a command that does not help.

### Changed

- After an automatic compaction with a handoff note, Claude stops.
  It tells the user where the note is, and it gives a prompt to send after `/clear`.
  On 2026-10-05, Claude wrote 21 handoff notes and continued in the compacted context after each one, so no note started a small context.
  The compacted conversation no longer gets the text of the note, because the fresh session reads the file.
  A manual `/compact` writes no note, because the user chose to continue in the same session.

### Removed

- The Stop verify gate is removed.
  It found a check only by a list of command names, so it sent Claude back after checks that are not in the list, such as `just markdown` or `bunx markdownlint-cli2`.
  The working rules still tell Claude to run a check and to name each skipped check.

## [0.20.8] - 2026-10-05

### Fixed

- Commits and pull requests of Claude get the git attribution again.
  The `includeGitInstructions: false` setting of the profile removes the `Co-Authored-By` trailer and the pull request footer of Claude Code.
  The 0.8 session note gave them back, but the 0.20.0 reset removed it.
  The session note reads the `attribution` and `includeCoAuthoredBy` settings, as Claude Code does.
  Claude Code 2.1.289 gives no `model` to a SessionStart command hook, so the note tells Claude to write the name of its model in the trailer, such as `Claude Sonnet 5.5`.
  The name then also follows a `/model` change.
- A repository with a remote of another owner gets no Claude attribution lines.
  A repository is the user's own when it has no remote, or when each remote is on GitHub under the `gh` login or under an organization where that login has the owner role.
  GitHub records no organization creator, so the owner role (`admin`) stands for it.
  A fork with an `upstream` of another owner is not the user's own.
  In such a repository, the session note tells Claude to follow the AI policy of the project and to use `/dotclaude:contribute`.
- The Bash guard checks the Claude attribution lines of `git commit` again, as it did before the 0.20.0 reset.
  In a repository of the user, it denies a Claude `Co-Authored-By` line when the settings leave the trailer out, because Claude adds the line from habit.
  In a repository of another owner, it asks before a commit with a Claude attribution line.

### Changed

- Each note that dotclaude or one of its plugins gives to an agent is a clause of the dotclaude Terms of Use.
  The session start gives the `dotclaude_terms_of_use` block, and each note comes in a `dotclaude_terms` tag with its clause number and title.
  The tag names the hook that enforces the clause.
  The wiki page `Terms-of-Use` lists the 10 clauses.
- The Jev note is clause 10, and the `dotclaude-jev` hooks module enforces it.
  When `TYPESAFE_API_KEY` is set, the module runs one `jev.mjs ask` call for each `AskUserQuestion`.
  Jev sorts each question into preference or facts, and picks from its options.
  A question that facts decide shows the pick of Jev and its confidence to the user.
  A question about a goal, a preference, or an approval stays as it is.
  The module does not deny `AskUserQuestion`, because a deny also blocked the questions that only the user can answer, and Claude could then ask in plain text.
  When Jev fails, the question passes unchanged.
- `just sandbox` loads each plugin in `plugins/`, so a sandbox test also covers `dotclaude-jev`.
  The `Sandbox` wiki page tells why a headless run denies a tool that `--allowedTools` does not list, and how to give `gh` the login of the user.
- The 3,000-line bound on runtime JavaScript (`RUNTIME_JS_LINES` and `tests/budget.test.mjs`) is removed.
  The new rule is that runtime JavaScript does only the work that the latest Claude Code does not do, and uses the settings and extension points of Claude Code when they exist.

### Added

- The `dotclaude-jev` plugin adds a session note that sends each decision through the `second-opinion` skill.
  The decisions are the close calls of Claude, the questions of the user that ask for a decision, a pick, or a rating, the technical decisions of the user, and each request for a second opinion.
  Claude asks each question with options through `AskUserQuestion`, so that the hooks module can add the pick of Jev.
  Goals, preferences, and approvals stay with the user.

## [0.20.7] - 2026-10-05

### Fixed

- The Stop verify gate sends its reason as `additionalContext`, so Claude Code shows "Stop hook feedback", not "Stop hook error".
  0.20.0 used `decision: "block"` again, which Claude Code shows as an error.

## [0.20.6] - 2026-10-05

### Changed

- The documentation moved to the [GitHub wiki](https://github.com/xsyetopz/dotclaude/wiki).
  The page source is in `wiki/`, and `just wiki` publishes it.
  `docs/README.md` now only links to the wiki pages.
- The release archive of 0.1 to 0.19 is now one consolidated wiki page for each release line, with [Release History](https://github.com/xsyetopz/dotclaude/wiki/Release-History) as its index.
- The external sources of the old `docs/external/` are now in `external/`, which git ignores.
- The `/dotclaude:setup` profile sets the claude.ai skills `docs`, `docx`, `pdf`, `pptx`, and `xlsx` to `off` in `skillOverrides`.
  `disableBundledSkills` does not remove them, because they come from the claude.ai account.
  The claude.ai connectors, such as Claude Docs and alphaXiv, stay on.

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
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.22.2...HEAD
