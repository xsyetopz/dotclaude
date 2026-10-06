# Release 0.22

Released 2026-10-05.
A new repository layout with one folder for each plugin, `just release`, and a profile drift notice at startup.
It adds the Terms of Use clauses for long runs, the AI policy of a project, and subagent progress, and the Bash guard asks before more kinds of commands.
A version in parentheses marks a later patch of this line, and an entry with no version comes from 0.22.0.

## Added

### Release and setup

- `just release` tags all plugins at `HEAD` and pushes the tags in one atomic push.
  Add `--dry-run` to preview the tags.
- At startup, the user gets a notice when the user settings, the `CLAUDE.md` block, or the status line launchers differ from the setup profile.
  The notice recommends `/dotclaude:setup`, and it shows once for each plugin version, so a value that the user keeps on purpose does not show at each start.
  The notice goes to the user only, and adds nothing to the context of Claude.

### CodeGraph and long runs

- A session in a git repository without a CodeGraph index tells Claude to run `codegraph init -y`.
  The Bash guard asks the user before `codegraph init` and `codegraph uninit`.
  This is clause 12 of the Terms of Use, `CodeGraph index`.
  The `codegraph` option turns the note off.
- The `CLAUDE.md` block has a CodeGraph rule: use `codegraph explore` before `grep` or a file read in a repository with an index.
  Setup removes the `CODEGRAPH_START` section of `codegraph install`, after a backup.
- Clause 13 of the Terms of Use, `Long runs`: before a loop over a step of unknown speed, time one run, give each run its own `timeout`, and run long work in the background.
  A foreground loop of slow runs once blocked a session.

### Bash guard (0.22.3)

- The Bash guard asks before 4 more kinds of commands.
  The old `guard_bash` description listed them, but the code did not ask.
  - A command that skips the git hooks: `--no-verify`, `git commit -n`, `-c core.hooksPath=...`, and `HUSKY=0`, `LEFTHOOK=0`, or `SKIP=...` before `git`.
  - A publish of a package or an image: `npm`, `pnpm`, `yarn`, or `bun` `publish`, `unpublish`, or `deprecate`, `cargo publish` or `yank`, `gem push` or `yank`, `twine upload`, `poetry`, `uv`, `vsce`, or `ovsx` `publish`, `docker` or `podman` `push`, and `dotnet nuget push`.
    A command with `--dry-run` passes.
  - A `gh` write: a verb that does not only read in a group such as `pr`, `issue`, `release`, or `repo`, and `gh api` with a method other than `GET` or with fields.
    A `gh api graphql` query passes, and a mutation or a query from a file asks.
  - A database delete: `DROP`, `TRUNCATE`, `DELETE FROM`, `FLUSHALL`, or `FLUSHDB` in a database client command, `dropdb`, `mysqladmin drop`, `prisma migrate reset`, `prisma db push --force-reset`, `rails` or `rake` `db:drop`, `db:reset`, or `db:schema:load`, and `manage.py flush`.
  - The guard also reads the tool that `npx`, `bunx`, or `python manage.py` runs.

## Changed

### Layout

- The repository has a new layout.
  The core plugin is in `plugins/dotclaude/`, next to `dotclaude-browser` and `dotclaude-jev`.
  Pure rules are in `lib/` (`guards/`, `notes/`, `setup/`), and the setup files are in `templates/` (`CLAUDE.md.block`, `settings.json`, `context/`).
  The tests are in one folder for each plugin, and the repository scripts are in `tools/`.
- In each plugin, `hooks/` has one folder for each hook event, and each script name tells what the script does.
  The hooks module of a plugin is `hooks/module/index.mjs`.
  The core plugin has `hooks/session-start/add-session-context.mjs` and `hooks/pre-tool-use/ask-guarded-calls.mjs`.
  `dotclaude-browser` has `hooks/session-start/add-browser-notes.mjs`, and `dotclaude-jev` has `hooks/session-start/second-opinion.md`.
- The wiki has the layout of the Claude Code docs: get started pages, task guides, reference tables, and evidence pages with a summary first (0.22.3).
  New pages: `Install`, `Quickstart`, `Guards`, `Handoffs`, `Browser`, `Second-Opinion`, and `Options`.

### Handoffs and prompts

- At a task boundary with open work, Claude writes or updates a handoff note, and gives `/clear` and a continuation prompt in the same reply.
  Before, Claude only said that it was a good time to run `/clear`.
  No hook enforces this, because only the reply text shows a break, and 0.18.1 removed the reply-text Stop gates.
- A prompt that Claude suggests names each file as `@` and its absolute path, so that Claude Code reads the file at once.
  After an automatic compaction, Claude writes the continuation prompt for the task, with `@` and the path of the note, in place of a fixed text.
- `RULES_MAX_BYTES` is 2,200, up from 2,000, for the handoff and prompt rules.

### CodeGraph and status line

- The CodeGraph augment builds an index in an old format again with `codegraph index` before a lookup, as it runs `codegraph sync` for changed files.
  The new bound `CODEGRAPH_INDEX_TIMEOUT_MS` is 30 s, because 1,296 files took 5 s.
- The subagent status line shows the context against the compaction point (117k), not against 100k or 150k.
  A subagent compacts at the same point as the main conversation.
  In 914 subagent runs of 7 days, the peak context stopped at about 117k, and 78 of 457 `implementer` runs showed a false warning past 100k.
  `SUBAGENT_CONTEXT_TOKENS` and `REVIEWER_CONTEXT_TOKENS` are removed.
- A status line launcher in the plugin cache has the same text for each plugin version.
  The launcher of 0.21.0 and older also has the script of one version as a fallback, so `/dotclaude:setup` writes it again one time.
  The launchers of 0.21.0 and older also run the status line of 0.22.0, because `status-line/` is at the same place in the plugin folder.

## Fixed

### Guards

- In auto mode, the Bash and edit guards ask the user again.
  Before, the auto-mode classifier got the ask of the hooks module and allowed the call, so `codegraph init -y` and `git branch -D` ran with no prompt.
  A classic `PreToolUse` hook, `hooks/pre-tool-use/ask-guarded-calls.mjs`, now gives the same ask, and the classifier cannot allow a call that a classic hook asks about.
  The options `guard_bash` and `guard_edit` also turn this hook off.
  The attribution ask of the Bash guard is still in the module only, so auto mode does not show it.
- The Bash guard gave the reason of only the first flagged target of an `rm -r` command (0.22.2).
  In `rm -rf /tmp/a.sh "${TMPDIR}"tmp.*`, the ask said only that the target is outside the project, and the approved command deleted the temporary folders of all programs.
  The ask now gives the reason of each flagged target.
- The `guard_bash` option description and the marketplace descriptions listed parts that the code no longer has: a check gate before stop, a model lock, a search deny, and the CAPTCHA OCR (0.22.3).
  They now list only what the code does.

### Project AI policy (0.22.1)

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

### Subagent progress (0.22.2)

- In one week, five subagents stopped at their turn limit, and Claude Code delivered no report from them, so all of their work was lost.
  Clause 15 of the Terms of Use, `Subagent progress`, now gives each subagent a progress file in the temporary folder, named by its agent ID.
  The subagent adds one line to the file after each step.
  This replaces the line in each agent file that told the agent to write its report as it went.
- When an agent stops at its turn limit, the main agent reads the progress file and continues the agent with `SendMessage`, and does not run the done steps again.
  The main agent also gives each agent a task that fits in its turn limit, and gives one subject to each research agent.
- The `test-runner` agent used one `Bash` call for each command of a batch, and three of them stopped at their 20-turn limit.
  It now runs a batch in one `Bash` call, with one log for each command, and reads all failed logs in one more call.

### Other

- `dotclaude-jev` no longer has a `tsconfig.json`.
  It extended `.claude-plugin/types/`, which an installed plugin does not get.
  The `tsconfig.json` at the repository root now gives the types to an editor.
- A prompt that Claude suggests after a handoff now puts a path with a space in quotes, as in `@"/a b/n.md"`.
  A space ends a bare `@` path, so Claude Code did not read the note.
  The working rules, the handoff skill, and the prompt after a compaction all use the quoted form.
  The working rules are shorter, so that they stay within `RULES_MAX_BYTES`.
- On Windows, the startup note did not name an old or missing status line launcher (0.22.1).
  Setup writes the launcher path as JSON with doubled backslashes, and the check looked for the path with single backslashes.
