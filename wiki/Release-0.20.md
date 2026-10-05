# Release 0.20

Released 2026-10-04 to 2026-10-05.
A full reset on Claude Code 2.1.289 that cut runtime JavaScript from 18,935 lines to 2,118 lines.
It adds a new status line, the `dotclaude-jev` plugin, the Terms of Use, and the CodeGraph augment.
A version in parentheses marks a later patch of this line, and an entry with no version comes from 0.20.0.

0.20.0 keeps the parts that serve a need that Claude Code does not cover, and it removes the rest.
Runtime JavaScript goes from 18,935 lines in 0.19.1 to 2,118 lines, and `tests/budget.test.mjs` bounds it at 3,000.
Run `/dotclaude:setup` again after you update.

## Added

### Reset parts

- `docs/parts.md`, a page that lists each part, its event, its bound, and the need that it serves.
- The rule that runtime JavaScript (`hooks/`, `status-line/`, `skills/`, `plugins/`) stays within `RUNTIME_JS_LINES` (3,000) in `hooks/lib/_budget.mjs`.
  0.19.1 had no bound on it, and its runtime JavaScript grew to 18,935 lines, much of it a copy of what Claude Code 2.1.287 to 2.1.289 does itself.
  0.20.8 removed this bound (see Changed, 0.20.8).
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
- The `backend` option of `dotclaude-browser`, which defaults to `agent-browser`.
  The value `cloakbrowser` runs `agent-browser` with the CloakBrowser binary through `--executable-path`, for sites with bot detection.

### Status line

- A status line with every 0.19 part, in less code, where each part has one shape: icon, bar, number.
  - One bar renderer, one icon set, and one color scale (`USAGE_LEVELS`) serve every percentage.
  - The rows are `core` (model, context, cache, limits), `place` (folder, branch, worktree, PR, loop), and `detail` (cache hit ratio and misses, limit pace, cost).
  - A `⚠` blinks for a handoff due (context at 90% of the compaction point), a cache that expires in two minutes or less, and a limit at 90%.
  - `⚠` also marks an effort that the rules do not allow for the model.
  - A second script shows the model and context of each running agent.
  - `/dotclaude:setup` writes two stubs in the config directory and sets `statusLine` and `subagentStatusLine` to run them, because a status line command gets an empty `${CLAUDE_PLUGIN_ROOT}`.
- Limit resets (0.20.1): the status line shows the limit resets that you can use, as `⟳2 by Oct 12 at 4am`: the count and the earliest expiry.
  - It reads them from the `cedar_ember` block of the `/usage` copy that Claude Code keeps in `.claude.json`, so it makes no network call.
  - A grant counts when it is not paused, has resets left, and is in its start to end span, as in Claude Code and CodexBar.
  - While a usage window is at its limit, the reset part outranks the other parts.
- Extra usage (0.20.1): the status line shows the extra usage spend while extra usage is on, as `extra █░░░░ $12.50/$50`, or `extra $12.50` with no monthly limit.
  It reads `extra_usage` from the same copy.

### Setup and profile (0.20.4)

- The profile sets `cleanupPeriodDays` to 14, `enableArtifact` to `false`, `disableBundledSkills` to `true`, and `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS` to `1`.
- `/dotclaude:setup` keeps the newest 3 backups of each file and deletes the older ones.
  It lists the memory files to review and the LSP plugins for the language servers on `PATH`.
- The setup integrations reference covers the LSP plugins and the `ctx7` CLI for library docs, with no MCP server.
  The `web-researcher` agent uses `ctx7` when it is on `PATH`, because it uses less context than a web search.
  When `ctx7` is rate-limited, the agent checks the limit with one call and uses `WebSearch` and `WebFetch` until the reset.
- `/dotclaude:setup` gives the command that adds a Context7 API key to the shell profile.
  The user runs it outside Claude Code, and setup then checks that the key gives a tier other than `anonymous`.
- The README has a "Save weekly usage" section, and the dossier ranks the community claims about usage.

### Rules, notes, and hooks (0.20.4)

- Each compaction note marks the earlier compaction note of the same session as `superseded`, because the new note carries its open items.
  Before, each compaction left one more `in-progress` note.
- The CodeGraph augment: when a `Grep` call or a Bash `rg` or `grep` search looks for one symbol name in a project with `.codegraph/`, the hooks module adds the callers and callees of that symbol to the search result.
  - Claude ignored rules that told it to run `codegraph`, so the graph now comes with the search that Claude already runs.
  - The design follows the GitNexus hooks.
  - Before a lookup, the hook runs `codegraph sync` if files changed since the last index, because without the MCP server the index does not update itself.
  - It never builds an index.
  - The plugin option `codegraph` turns it off.
- The minimal-code rules: session start tells Claude to build the minimum, with the idea of Ponytail.
  The plugin option `ponytail` turns them off.
- Usage habits in the working rules: a handoff note and `/clear` at a task boundary, `/btw` for a side question, a lower effort in place of a model change, and a model change only after `/clear`.
- Line breaks in the working rules: in Markdown, comments, commits, and PRs, Claude starts each sentence on a new line and does not break lines at a column, as in [Semantic Line Breaks](https://sembr.org/).
  - Claude hard-wrapped prose at about 80 columns, which breaks reflow in editors and terminals and makes diffs larger.
  - A project style takes precedence.
  - Shorter wording of the other rules keeps the file within its 2,000-byte bound.
  - Claude Code 2.1.289 has no `CLAUDE_NO_WRAP` variable or `--no-word-wrap` flag, and a plugin cannot change how the terminal wraps output.

### Jev plugin

- The optional `dotclaude-jev` plugin (0.20.4): its `second-opinion` skill asks TypeSafe Jev, a decision model, for a yes or no check, a pick from options, or a rating, with a probability for each answer.
  - Claude uses it for its own close calls, and still asks the user the questions that only the user can answer.
  - It also checks a technical decision of the user: when Jev finds that facts decide it and that it causes defects, Claude tells the user the facts once and asks for a confirmation, and the answer of the user is final.
  - It needs `TYPESAFE_API_KEY`.
- The `dotclaude-jev` plugin (0.20.8) adds a session note that sends each decision through the `second-opinion` skill.
  - The decisions are the close calls of Claude, the questions of the user that ask for a decision, a pick, or a rating, the technical decisions of the user, and each request for a second opinion.
  - Claude asks each question with options through `AskUserQuestion`, so that the hooks module can add the pick of Jev.
  - Goals, preferences, and approvals stay with the user.

## Changed

### Reset

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

### Status line

- The status line has one row for each topic (0.20.2).
  - The first row is the session: model, context, and cache expiry.
  - The second row is the usage: each window, limit resets, and extra usage.
  - The third row is the place, and then the detail: cache hit ratio, cost, lines, and time.
- Each usage window shows its deficit or reserve in its own part (0.20.2), as `7d █████  99% ▲16%→3:41am ↻Oct 5 at 7am`.
  A pace thus never shows without its window, and it drops only with its window.
- The cache hit ratio reads as `hit 96%` (0.20.2).
  Before, it had the `◷` icon of the cache expiry.
- A blinking `⚠` shows dim in its off frame (0.20.2).
  Before, a blank space showed, and it looked like a gap after the separator.
- A status line group of one part shares its row with the next group (0.20.3).
  Thus the model does not stand alone on the first row when the context and the cache are not known yet.
- The status line code is in modules with one job each (0.20.3): `paint.mjs` (icons, colors, bars), `format.mjs` (model names, times, money), `parts.mjs` (one function for each part), `layout.mjs` (rows), and `render.mjs` (both status lines).
  `shared.mjs` is gone.
- The status line reads the `/usage` copy on each run (0.20.1), not only when the status JSON has no usage windows.
  The windows of the status JSON still have priority.

### Documentation and setup

- The documentation moved to the [GitHub wiki](https://github.com/xsyetopz/dotclaude/wiki) (0.20.6).
  The page source is in `wiki/`, and `just wiki` publishes it.
  `docs/README.md` now only links to the wiki pages.
- The release archive of 0.1 to 0.19 is now one consolidated wiki page for each release line (0.20.6), with [Release History](Release-History) as its index.
- The external sources of the old `docs/external/` are now in `external/`, which git ignores (0.20.6).
- The `/dotclaude:setup` profile sets the claude.ai skills `docs`, `docx`, `pdf`, `pptx`, and `xlsx` to `off` in `skillOverrides` (0.20.6).
  `disableBundledSkills` does not remove them, because they come from the claude.ai account.
  The claude.ai connectors, such as Claude Docs and alphaXiv, stay on.
- Plugin, agent, and skill descriptions and hook messages put code items in backticks (0.20.4).

### Terms of Use and Jev (0.20.8)

- Each note that dotclaude or one of its plugins gives to an agent is a clause of the dotclaude Terms of Use.
  The session start gives the `dotclaude_terms_of_use` block, and each note comes in a `dotclaude_terms` tag with its clause number and title.
  The tag names the hook that enforces the clause.
  The wiki page `Terms-of-Use` lists the 10 clauses.
- The Jev note is clause 10, and the `dotclaude-jev` hooks module enforces it.
  - When `TYPESAFE_API_KEY` is set, the module runs one `jev.mjs ask` call for each `AskUserQuestion`.
  - Jev sorts each question into preference or facts, and picks from its options.
  - A question that facts decide shows the pick of Jev and its confidence to the user.
  - A question about a goal, a preference, or an approval stays as it is.
  - The module does not deny `AskUserQuestion`, because a deny also blocked the questions that only the user can answer, and Claude could then ask in plain text.
  - When Jev fails, the question passes unchanged.
- `just sandbox` loads each plugin in `plugins/`, so a sandbox test also covers `dotclaude-jev`.
  The `Sandbox` wiki page tells why a headless run denies a tool that `--allowedTools` does not list, and how to give `gh` the login of the user.
- The 3,000-line bound on runtime JavaScript (`RUNTIME_JS_LINES` and `tests/budget.test.mjs`) is removed.
  The new rule is that runtime JavaScript does only the work that the latest Claude Code does not do, and uses the settings and extension points of Claude Code when they exist.

## Removed

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

## Fixed

### Reset

- A model strip defect: `prefer-dotclaude-agents` removed the `model` that a spawn call gave, so the agent ran on another model than the call asked for.
  `agent.spawn` now denies a `model` that is not the one that the agent file fixes, and the reason names the fixed model.
- `scripts/usage-report.mjs` runs again.
- `just sandbox` applies the setup profile and the status line again.
  It ran the deleted `apply-statusline.mjs` and hid the error.

### Status line

- The status line stubs that `/dotclaude:setup` writes run the newest plugin version in the plugin cache (0.20.3).
  Before, they ran the version that was current at setup, so a plugin update did not change the status line until setup ran again.
- A date and time in the status line read as `Oct 12 at 4am` on all systems (0.20.2).
  Some ICU versions, as on Linux and Windows, joined them as `Oct 12, 4am`, and the test failed there.
- The 7d deficit or reserve did not show in a narrow terminal, also while the 7d window was past the first usage level (0.20.2).
  The 5h pace could also show without its window.

### Gates, notes, and setup

- The Stop verify gate sends its reason as `additionalContext` (0.20.7), so Claude Code shows "Stop hook feedback", not "Stop hook error".
  0.20.0 used `decision: "block"` again, which Claude Code shows as an error.
- The verify gate no longer asks for a check after an edit to a file outside the project, such as a plan file in `~/.claude/plans/` (0.20.4).
- The verify gate no longer counts an edit that failed, such as a `Write` that a permission denied (0.20.4).
  Before, a denied `Write` sent Claude back for a check of a change that did not occur.
- Setup keeps a status line of another tool, and tells you how to replace it with `--status-line` (0.20.4).
  Before, it replaced the status line without a question.
- A resumed session with an expired cache and less than 100k tokens of context no longer gets the cold cache notice, as in 0.19 (0.20.4).
  The cache write of a small context costs little.
- The handoff pointer and the compaction note tell Claude to set a note to `done` only when each item in its Open section is done (0.20.4).
  Before, the pointer said to close a note when "the work" was complete, and an agent closed a note whose Open list still had items.
- The Context7 rate-limit check in `/dotclaude:setup` reads the status and the tier correctly (0.20.5).
  - Context7 refuses a key that is not valid with `HTTP/2 401`, and it can show `context7-quota-tier: anonymous` for a valid key.
  - Before, setup told the user that the key was not valid when the tier was `anonymous`.
  - Setup also asks for a key only when `CONTEXT7_API_KEY` is not set.
- `/dotclaude:setup` suggests each curated LSP plugin of the `claude-plugins-official` marketplace whose language server is on `PATH` (0.20.5).
  - It reads the plugins from the marketplace manifest, so a new curated plugin shows with no dotclaude release.
  - Before, a fixed table of 6 plugins left out `csharp-lsp`, `jdtls-lsp`, `kotlin-lsp`, `lua-lsp`, `php-lsp`, and `ruby-lsp`.
  - For an installed plugin that is disabled, setup gives `/plugin enable`.
  - Before, setup counted an installed plugin as done, also when it was disabled.

### Attribution (0.20.8)

- Commits and pull requests of Claude get the git attribution again.
  - The `includeGitInstructions: false` setting of the profile removes the `Co-Authored-By` trailer and the pull request footer of Claude Code.
  - The 0.8 session note gave them back, but the 0.20.0 reset removed it.
  - The session note reads the `attribution` and `includeCoAuthoredBy` settings, as Claude Code does.
  - Claude Code 2.1.289 gives no `model` to a SessionStart command hook, so the note tells Claude to write the name of its model in the trailer, such as `Claude Sonnet 5.5`.
  - The name then also follows a `/model` change.
- A repository with a remote of another owner gets no Claude attribution lines.
  - A repository is the user's own when it has no remote, or when each remote is on GitHub under the `gh` login or under an organization where that login has the owner role.
  - GitHub records no organization creator, so the owner role (`admin`) stands for it.
  - A fork with an `upstream` of another owner is not the user's own.
  - In such a repository, the session note tells Claude to follow the AI policy of the project and to use `/dotclaude:contribute`.
- The Bash guard checks the Claude attribution lines of `git commit` again, as it did before the 0.20.0 reset.
  - In a repository of the user, it denies a Claude `Co-Authored-By` line when the settings leave the trailer out, because Claude adds the line from habit.
  - In a repository of another owner, it asks before a commit with a Claude attribution line.

Previous: [Release 0.19](Release-0.19) · Next: [Release 0.21](Release-0.21)
