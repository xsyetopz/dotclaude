# Parts

This page lists each part of dotclaude 0.20.0, the event that runs it, its bound, and the need that it serves.
All bounds are in `hooks/lib/_budget.mjs`.
Tests pin the copies of a bound in code and config.

## Hooks

Each note of these parts to an agent is a clause of the [Terms of Use](Terms-of-Use).

| Part | Event | Bound in `_budget.mjs` | User need |
| --- | --- | --- | --- |
| Bash guard (`guard_bash`) | `tool.call` | `COMMAND_PART_CHARS` | Ask before a forced push, a hard reset, a `git checkout` or `git restore` of files, a recursive removal outside the project, `sudo`, or a write to a device. The reason shows the command part. Deny a Claude `Co-Authored-By` line in a commit when the settings leave it out, and ask before a Claude attribution line in a repository of another owner. |
| Edit guard (`guard_edit`) | `tool.call` | none | Ask before an edit that removes test assertions, adds a skip marker, writes a `[REDACTED:` marker, or changes a generated file, a lockfile, or a Claude Code settings file. |
| Secret redaction (`guard_secrets`) | `tool.call` | `SECRET_SCAN_TIMEOUT_MS`, `SECRET_SCAN_MAX_BYTES` | Keep a secret in a tool result out of the context. Betterleaks finds it, and the result shows `[REDACTED:<rule>]`. |
| Spawn rules (`guard_agents`) | `agent.spawn` | `SUBAGENT_EFFORTS` | Keep the subagent model and effort within the [rules](#model-and-effort-rules). The hook denies a call that asks for another model than the agent file fixes, and gives the reason. |
| Cold-cache note | `SessionStart` (resume), `prompt.submit` | `CACHE_TTL_MS` | Tell Claude that the prompt cache expired, so that it says what a handoff note and `/clear` can save. |
| Compaction | `session.compact` | `HANDOFF_FORK_TIMEOUT_MS` | Keep an unapproved plan or an open question open after a compaction, and keep the task state in a handoff note (`compaction_handoff`) before an automatic compaction. Then Claude stops and tells the user to run `/clear`. |
| Working rules | `SessionStart` | `RULES_MAX_BYTES` | Give Claude the few rules that have a stated incident, in at most 2,000 bytes. |
| Git attribution | `SessionStart` | none | Put back the `Co-Authored-By` trailer and the pull request footer that `includeGitInstructions: false` removes. A repository with a remote of another owner gets no lines, because the AI policy of that project decides. The owners are the `gh` login and the organizations where it has the owner role. |
| Line breaks (`sembr`) | `tool.call` | `SEMBR_MIN_TOKENS`, `SEMBR_MAX_TOKENS`, `SEMBR_TIMEOUT_MS`, `LINE_BREAK_NOTE_MAX_BLOCKS` | Keep semantic line breaks in the prose that Claude writes. `sembr` rewraps the message of a `git commit`, `gh pr`, or `gh issue` command before it runs. After a `Write` or `Edit` of Markdown or code comments that break at a column, the result gets the `sembr` text. |
| Handoff pointer | `SessionStart` | none | Point a new or cleared session to the newest handoff note with `status: in-progress`. |

The module `hooks/register.mjs` runs the first six rows through the Claude Code hooks module, so a tool call starts no process.
Where Claude Code does not load modules, such as with `--bare`, no guard runs.
The one classic hook is `hooks/session-start/context.mjs`.

## Status line

| Part | Event | Bound in `_budget.mjs` | User need |
| --- | --- | --- | --- |
| `status-line/main.mjs` | `statusLine` | `MAIN_CONTEXT_TOKENS`, `AUTO_COMPACT_TOKENS`, `USAGE_LEVELS` | See the model and effort, the context against the compaction point, the cache expiry, and the 5-hour and weekly limits. It warns when the effort is above the rule of the model. |
| `status-line/subagents.mjs` | `subagentStatusLine` | `SUBAGENT_CONTEXT_TOKENS`, `REVIEWER_CONTEXT_TOKENS` | See the model and context of each running agent. |

`/dotclaude:setup` writes two stubs that run these scripts, because a status line command gets an empty `${CLAUDE_PLUGIN_ROOT}`.
Each stub runs the newest plugin version in the plugin cache, so a plugin update needs no new stubs.

## Agents, skills, and style

| Part | What it does | User need |
| --- | --- | --- |
| `investigator`, `web-researcher` | Read and research in a separate context. | Keep long reads out of the main context. |
| `implementer` | Makes one scoped change with a known check. | Give edits to a cheaper model. |
| `reviewer`, `debugger` | Review a diff, and find the cause of a failure. | A second reading with fresh context. |
| `test-runner` | Runs tests and reports the result. | Run checks on the cheapest model. |
| `reverse-engineer` | Reads binaries and file formats. | The one role that stays on Opus. |
| `/dotclaude:setup` | Merges the settings profile and writes the status line stubs. | A plugin cannot set permissions, environment variables, or models. |
| `/dotclaude:handoff` | Writes a note that a fresh session continues from. | Long sessions cost the most, and a note costs less than a late compaction. |
| `/dotclaude:contribute` | Checks the AI policy of a project and drafts the contribution. | A contribution to another project speaks for the user. |
| `Concise` output style | Short replies that start with the result. | Replies that are fast to read. |
| `dotclaude-browser` plugin | Loads the `drive-web-browser` skill at session start. | Browser work with `agent-browser`, and CloakBrowser on a site with bot detection. |
| `dotclaude-jev` plugin | Loads the `second-opinion` skill, which asks TypeSafe Jev about a decision of Claude. Its session note sends each decision and each question with options through Jev, and its hooks module adds the pick of Jev to each `AskUserQuestion` question that facts decide. | A calibrated check of a close call, at $0.042 for each million input tokens. |

Each agent has `maxTurns` in its file.
The values are 20 for `test-runner`, 40 for `investigator`, 60 for the others, and 80 for `implementer`.

## Model and effort rules

| Model | Efforts |
| --- | --- |
| Opus 5.5 | `low`, `medium`, `high` |
| Sonnet 5.5 | `low`, `medium` |
| Haiku 4.5 | none |

The profile sets `maxEffortLevel` to `high`, so `xhigh` and `max` stay blocked.
Fable 5.1 is not in `availableModels`, and a subagent never runs on it.
No hook event fires when the effort of the main session changes, so the status line warns and nothing denies.

## Runtime scope

Runtime JavaScript is all `.mjs` files in `hooks/`, `status-line/`, `skills/`, and `plugins/`.
It does only the work that the latest Claude Code does not do.
When Claude Code has a setting, a hook, or another extension point for a need, dotclaude uses it.
Release 0.19.1 had 18,935 lines.
