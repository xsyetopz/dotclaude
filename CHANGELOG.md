# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

## [0.22.3] - 2026-10-05

### Added

- Bash guard: asks before 4 more kinds of commands.
  The old `guard_bash` description listed them, but the code did not ask.
  - A command that skips the git hooks: `--no-verify`, `git commit -n`, `-c core.hooksPath=...`, and `HUSKY=0`, `LEFTHOOK=0`, or `SKIP=...` before `git`.
  - A publish of a package or an image: `npm`, `pnpm`, `yarn`, or `bun` `publish`, `unpublish`, or `deprecate`, `cargo publish` or `yank`, `gem push` or `yank`, `twine upload`, `poetry`, `uv`, `vsce`, or `ovsx` `publish`, `docker` or `podman` `push`, and `dotnet nuget push`.
    A command with `--dry-run` passes.
  - A `gh` write: a verb that does not only read in a group such as `pr`, `issue`, `release`, or `repo`, and `gh api` with a method other than `GET` or with fields.
    A `gh api graphql` query passes, and a mutation or a query from a file asks.
  - A database delete: `DROP`, `TRUNCATE`, `DELETE FROM`, `FLUSHALL`, or `FLUSHDB` in a database client command, `dropdb`, `mysqladmin drop`, `prisma migrate reset`, `prisma db push --force-reset`, `rails` or `rake` `db:drop`, `db:reset`, or `db:schema:load`, and `manage.py flush`.
  - The guard also reads the tool that `npx`, `bunx`, or `python manage.py` runs.

### Changed

- The wiki now has the layout of the Claude Code docs: get started pages, task guides, reference tables, and evidence pages with a summary first.
  New pages: `Install`, `Quickstart`, `Guards`, `Handoffs`, `Browser`, `Second-Opinion`, and `Options`.

### Fixed

- The `guard_bash` option description and the marketplace descriptions listed parts that the code no longer has: a check gate before stop, a model lock, a search deny, and the CAPTCHA OCR.
  They now list only what the code does.

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

## Older Releases

| Series | Releases |
| --- | --- |
| [0.21](https://github.com/xsyetopz/dotclaude/wiki/Release-0.21) | 0.21.0 |
| [0.20](https://github.com/xsyetopz/dotclaude/wiki/Release-0.20) | 0.20.8, 0.20.7, 0.20.6, 0.20.5, 0.20.4, 0.20.3, 0.20.2, 0.20.1, 0.20.0 |
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
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.22.3...HEAD
