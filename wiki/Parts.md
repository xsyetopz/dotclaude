# Parts

This page lists each part of dotclaude 0.26.0, the event that runs it, its bound, and the need that it serves.
All bounds are in `plugins/dotclaude/lib/budget.mjs`, and tests pin the copies of a bound in code and config.

## Hooks

Each note of these parts to an agent is a section or a rule of the [operating spec](Operating-Spec).
See [Terms of Use](Terms-of-Use) for how the spec reaches an agent.

| Part | Event | Bound in `budget.mjs` | What it does |
| --- | --- | --- | --- |
| Bash guard (`guard_bash`) | `tool.call` | `COMMAND_PART_CHARS` | Asks before a risky command. Denies a Claude trailer that the settings leave out. |
| Edit guard (`guard_edit`) | `tool.call` | none | Asks before a risky edit. |
| Plugin publish ask | `tool.call`, `PreToolUse` | none | Asks before a `PublishPlugin` call. |
| Secret redaction (`guard_secrets`) | `tool.call` | `SECRET_SCAN_TIMEOUT_MS`, `SECRET_SCAN_MAX_BYTES` | Keeps a secret in a tool result out of the context. |
| Project AI policy guard (`guard_policy`) | `PreToolUse`, `tool.call` | `POLICY_FETCH_TIMEOUT_MS`, `POLICY_FILE_MAX_CHARS`, `POLICY_REASON_MAX_CHARS`, `POLICY_PATHS_MAX` | Respects a project that forbids AI tools. |
| Spawn rules (`guard_agents`) | `agent.spawn` | `SUBAGENT_EFFORTS` | Keeps the subagent model and effort within the [rules](#model-and-effort-rules). |
| Cold-cache note | `SessionStart` (resume), `prompt.submit` | `CACHE_TTL_MS` | Tells Claude that the prompt cache expired. |
| Compaction | `session.compact` | `HANDOFF_FORK_TIMEOUT_MS` | Keeps an open plan or question, and writes a handoff note before an automatic compaction. |
| Working rules (section 1) | `SessionStart` | `RULES_MAX_BYTES` | Gives the main agent section 1 of the operating spec, in at most 2,000 bytes. |
| Minimal code (section 2) | `SessionStart` | `MINIMAL_CODE_MAX_BYTES` | Gives the main agent section 2, in at most 800 bytes, unless the option `ponytail` is `false`. |
| Long runs (section 8) | `SessionStart` | none | Tells Claude to time and bound long steps. |
| Subagent progress (section 10) | `SubagentStart` | none | Keeps the work of a subagent that stops at its turn limit. |
| Questions to the user (section 11) | `SessionStart`, `Stop` | none | Keeps each question to the user in `AskUserQuestion`. |
| Checks (section 12) | `SessionStart`, `Stop` | none | Keeps a known defect or a skipped check out of a done report. |
| CodeGraph call paths (`codegraph`) | `tool.call` | `CODEGRAPH_TIMEOUT_MS`, `CODEGRAPH_QUERY_LIMIT`, `CODEGRAPH_NEIGHBOURS`, `CODEGRAPH_NOTE_MAX_CHARS` | Adds callers and callees to a symbol search. |
| CodeGraph index (`codegraph`) | `SessionStart` | none | Tells Claude to index a git repository. |
| Git attribution | `SessionStart` | none | Puts back the commit trailer and pull request footer. |
| Line breaks (`sembr`) | `tool.call` | `SEMBR_MIN_TOKENS`, `SEMBR_MAX_TOKENS`, `SEMBR_TIMEOUT_MS`, `LINE_BREAK_NOTE_MAX_BLOCKS` | Keeps semantic line breaks in the prose that Claude writes. |
| Stale-setup notice | `SessionStart` (startup) | none | Tells the user that the setup differs from the profile. |
| Handoff pointer | `SessionStart` | none | Points a new session to the newest open handoff note. |

See [Guards](Guards) for how each guard decides, and [Options](Options) for the options that turn a part off.

### Hook detail

Bash guard:

- It asks before a forced push, a hard reset, a `git checkout` or `git restore` of files, a recursive removal outside the project, `sudo`, or a write to a device.
- It asks before a command that skips the git hooks, a publish of a package or an image, a `gh` write, or a database delete.
- The reason shows the command part.
- It denies a Claude `Co-Authored-By` line in a commit when the settings leave it out.
- It asks before a Claude attribution line in a repository of another owner.

Edit guard:

- It asks before an edit that removes test assertions, adds a skip marker, writes a `[REDACTED:` marker, or changes a generated file, a lockfile, or a Claude Code settings file.

Plugin publish ask:

- `PublishPlugin` (Claude Code 2.1.292) publishes a plugin to the claude.ai library of the organization, where other people can see it.
- No `guard_*` option turns this ask off.

Secret redaction:

- Betterleaks finds the secret, and the result shows `[REDACTED:<rule>]`.

Project AI policy guard:

- Before the first call of a session that reaches a project of another owner with a `CLAUDE.md`, `AGENTS.md`, or `AI_POLICY.md` file, it asks the user and shows the policy.
- A reach is a GitHub fetch (`git clone`, `gh repo clone`, `gh api`, `curl`, `wget`, or `WebFetch`) or a path in a local clone outside the project.
- After a GitHub fetch, it shows the policy to Claude.
- The `PreToolUse` hook gives the policy section of the operating spec to Claude, with the policy file, when it asks.
  A subagent once fetched the code of a project whose policy forbids AI tools.
- It does not cover other hosts.

Spawn rules:

- The hook denies a call that asks for another model than the agent file fixes, and gives the reason.

Cold-cache note:

- Claude then says what a handoff note and `/clear` can save.

Compaction:

- The hook keeps an unapproved plan or an open question open after a compaction.
- It keeps the task state in a handoff note (`compaction_handoff`) before an automatic compaction.
- Then Claude stops and tells the user to run `/clear`.

Long runs:

- Claude times one run of a step of unknown speed, gives each run a `timeout`, and runs long work in the background.
- When a background run stalls, or a run waits on a stale process, lock, or monitor, Claude stops that blocker and runs the step again, also when Claude did not start it.
- Rule 8.1 of the [operating spec](Operating-Spec) has no hook.

Subagent progress:

- Claude Code delivers no report from a subagent that stops at its turn limit.
- Each subagent adds a line after each step to `dotclaude-progress/<agent ID>.md` in the temporary folder.
- The main agent reads the file and continues the agent with `SendMessage`.
- When `SendMessage` cannot continue the agent, the main agent starts one new agent in the same worktree folder, with the progress file and the diff.
- Rule 10.7 of the [operating spec](Operating-Spec) has no hook.

Questions to the user:

- The `Stop` hook blocks the end of a turn whose last message asks the user a question in plain text.
- It blocks only once in a row, so Claude can end a turn whose question is not to the user.
- [Rule 11.1](Terms-of-Use#rule-111) has the detail.

Known defects:

- The note tells Claude to fix each defect in its own change, and to report a defect outside the request with its evidence.
  The main agent then asks the user to fix it now, or to keep it open with a reason and an owner.
- A prompt hook (`"type": "prompt"`) on `Stop` blocks a last message that calls a part done that no check passed on.
  A **Not verified** list does not count.
- It blocks only once in a row.
- It uses the background model of Claude Code, so each stop adds one model call.
- [Rule 12.1](Terms-of-Use#rule-121) has the detail.

CodeGraph call paths:

- Before the search, the module runs `codegraph index -q` when the index has an old format.
- It runs `codegraph sync` when files changed.
- The bounds are `CODEGRAPH_INDEX_TIMEOUT_MS` and `CODEGRAPH_SYNC_TIMEOUT_MS`.

CodeGraph index:

- The part works in a git repository with no `.codegraph/` and with `codegraph` on `PATH`.
- It tells Claude (rule 6.2) to run `codegraph init -y`.
- The Bash guard asks the user before `codegraph init` and `codegraph uninit`.
- The option `codegraph` turns the note off.

Git attribution:

- `includeGitInstructions: false` removes the `Co-Authored-By` trailer and the pull request footer, and this part puts them back.
- A repository with a remote of another owner gets no lines, because the AI policy of that project decides.
- The owners are the `gh` login and the organizations where it has the owner role.

Line breaks:

- `sembr` rewraps the message of a `git commit`, `gh pr`, or `gh issue` command before it runs.
- After a `Write` or `Edit` of Markdown or code comments that break at a column, the result gets the `sembr` text.
- It skips front matter, headings, tables, and code fences.
  A line that starts with a lowercase `key:` is front matter, because an `Edit` sends only its new text, with no `---` line.

Stale-setup notice:

- It tells the user, not Claude, that the user settings or the `CLAUDE.md` block differ from the setup profile.
- It recommends `/dotclaude:setup`.
- The notice shows once for each plugin version, and `<config dir>/dotclaude/setup-noticed` records the version.

Handoff pointer:

- The note is the newest handoff note with `status: in-progress`.

## How the hooks run

The module `plugins/dotclaude/hooks/module/index.mjs` runs the rows with an event of a tool, an agent, a prompt, or a compaction.
It uses the Claude Code hooks module.
Where Claude Code does not load modules, such as with `--bare`, only the classic `PreToolUse` hook guards.

| Classic hook | What it does |
| --- | --- |
| `hooks/session-start/add-session-context.mjs` | Adds the `SessionStart` rows. Its `setupNotice` shows the stale-setup notice. |
| `hooks/pre-tool-use/ask-guarded-calls.mjs` | Gives the asks of the Bash and edit guards again, and the ask of the policy guard with the policy section as context. |
| `hooks/subagent-start/add-subagent-context.mjs` | Gives each subagent section 10 of the operating spec (the subagent rules) and the path of its progress file. |
| `hooks/stop/block-plain-questions.mjs` | Blocks the end of a turn that asks the user a question in plain text. |
| Prompt hook on `Stop` | Blocks the end of a turn that calls a part done that no check passed on (rule 12.1). Its prompt is in `hooks/hooks.json`. |

- The `PreToolUse` hook gives the asks again because in auto mode the classifier can allow a call that the module asks about.
  See [Claude mods](Claude-Mods).
- It starts one process for each `Bash`, `Edit`, `Write`, `WebFetch`, `Read`, `Grep`, `Glob`, and `PublishPlugin` call.
- The `SubagentStart` hook exists because a subagent does not get the `SessionStart` context.
- `plugins/dotclaude/lib/setup/diff.mjs` compares the user setup with the profile for the stale-setup notice.

## Source layout

| Folder or file | Holds |
| --- | --- |
| `plugins/dotclaude/lib/guards/` | The guard rules |
| `plugins/dotclaude/lib/notes/` | The notes to Claude |
| `plugins/dotclaude/lib/setup/` | The setup helpers |
| `budget.mjs`, `plan.mjs`, `terms.mjs` | Bounds, plan detection, and the operating spec (`SECTIONS`) |
| `plugins/dotclaude/templates/` | The setup profile and the `CLAUDE.md` block |

- `lib/` imports only itself.
- `hooks/`, `status-line/`, and the skill scripts import only `lib/` and their own folder.
- The templates are `CLAUDE.md.block` and `settings.json`.
  The rules that hooks add to the context are in `terms.mjs`, not in template files.
- `/dotclaude:setup` merges `CLAUDE.md.block` and `settings.json` into the files of the user.
- The block has a `<codegraph>` rule, and setup removes an old `CODEGRAPH_START` section after a backup.

## Status line

| Part | Event | Bound in `budget.mjs` | What it shows |
| --- | --- | --- | --- |
| `status-line/main.mjs` | `statusLine` | `MAIN_CONTEXT_TOKENS`, `AUTO_COMPACT_TOKENS`, `USAGE_LEVELS` | The model and effort, the context against the compaction point, the cache expiry, and the 5-hour and weekly limits. It warns when the effort is above the rule of the model. |
| `status-line/subagents.mjs` | `subagentStatusLine` | `AUTO_COMPACT_TOKENS` | The model and context of each running agent, against the compaction point. |

- `/dotclaude:setup` writes two stubs that run these scripts, because a status line command gets an empty `${CLAUDE_PLUGIN_ROOT}`.
- Each stub runs the newest plugin version in the plugin cache, so a plugin update needs no new stubs.

## Agents

| Agent | What it does | User need | `maxTurns` |
| --- | --- | --- | --- |
| `investigator` | Reads in a separate context, and audits dependencies for CVEs, licenses, and abandoned packages. | Keep long reads out of the main context. | 40 |
| `web-researcher` | Researches in a separate context. | Keep long reads out of the main context. | 60 |
| `implementer` | Makes one scoped change with a known check. | Give edits to a cheaper model. | 80 |
| `reviewer` | Reviews a diff, a plan, an API design, or the security of a whole feature. | A second reading with fresh context. | 60 |
| `debugger` | Finds the cause of a failure. | A second reading with fresh context. | 60 |
| `test-runner` | Runs tests and reports the result. | Run checks on the cheapest model. | 20 |
| `reverse-engineer` | Reads binaries and file formats. | The one role that stays on Opus. | 60 |
| `translator` | Translates and localizes strings and docs, and lists the defects before it edits. | Give translations to an agent that keeps keys and placeholders. | 60 |
| `docs-writer` | Makes the docs agree with the code, with no `Bash`. | Give docs work to an agent that checks each claim in the code. | 40 |
| `digest-writer` | Writes a short digest of long material, with references. | Read long material on the cheapest model. | 20 |
| `eval-designer` | Writes eval cases and graders, and checks that each case fails on a baseline. | Measure a prompt, skill, or agent, and not only test code. | 60 |
| `fuzz-engineer` | Writes fuzz and property tests, and reduces each crash to a minimal input. | Find the inputs that break a parser or a protocol. | 60 |
| `infra-engineer` | Writes CI, container, build, and deploy config, and stops before an apply or a deploy. | Infra changes that leave each live change to the user. | 60 |

`AGENTS_MAX_BYTES` (32,000 bytes) bounds all agent files together, because each spawn sends its agent body.
A test fails above it.

## Skills, output style, and plugins

| Part | What it does | User need |
| --- | --- | --- |
| `/dotclaude:setup` | Merges the settings profile and writes the status line stubs. | A plugin cannot set permissions, environment variables, or models. |
| `/dotclaude:handoff` | Writes a note that a fresh session continues from. | Long sessions cost the most, and a note costs less than a late compaction. |
| `/dotclaude:contribute` | Checks the AI policy of a project and drafts the contribution. | A contribution to another project speaks for the user. |
| `Concise` output style | Gives short replies that start with the result. | Replies that are fast to read. |
| `dotclaude-browser` plugin | Loads the `drive-web-browser` skill at session start. | Browser work with `agent-browser`, and CloakBrowser on a site with bot detection. |
| `dotclaude-jev` plugin | Loads the `second-opinion` skill, which asks TypeSafe Jev about a decision of Claude. | A calibrated check of a close call, at $0.042 for each million input tokens. |
| `dotclaude-modder` plugin | Gives section 15 of the operating spec, denies a kill by process name, and adds the game modding skills and the `um` command. | Mods of PC games that the user owns, with backups and no online play. |

The session note of `dotclaude-jev` sends each decision and each question with options through Jev.
Its hooks module adds the pick of Jev to each `AskUserQuestion` question that facts decide.

## Model and effort rules

| Model | Efforts |
| --- | --- |
| Opus 5.5 | `low`, `medium`, `high` |
| Sonnet 5.5 | `low`, `medium` |
| Haiku 4.5 | none |

- The profile sets `maxEffortLevel` to `high`, so `xhigh` and `max` stay blocked.
- Fable 5.1 is not in `availableModels`, and a subagent never runs on it.
- No hook event fires when the effort of the main session changes, so the status line warns and nothing denies.

## Runtime scope

- Runtime JavaScript is all `.mjs` files in `plugins/`.
- It does only the work that the latest Claude Code does not do.
- When Claude Code has a setting, a hook, or another extension point for a need, dotclaude uses it.
- Release 0.19.1 had 18,935 lines.

## Related pages

- [Guards](Guards) tells how each guard decides.
- [Options](Options) lists the options that turn a part off.
- [Operating spec](Operating-Spec) lists each section and rule.
- [Terms of Use](Terms-of-Use) tells how the spec reaches an agent.
- [Claude mods](Claude-Mods) describes the hooks module.
