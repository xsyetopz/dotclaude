# Parts

Part of the [dotclaude documentation](README.md).

This page lists each part of dotclaude 0.20.0, the event that runs it, its bound, and the need that it serves.
All bounds are in `hooks/lib/_budget.mjs`.
Tests pin the copies of a bound in code and config.

## Hooks

| Part | Event | Bound in `_budget.mjs` | User need |
| --- | --- | --- | --- |
| Bash guard (`guard_bash`) | `tool.call` | `COMMAND_PART_CHARS` | Ask before a forced push, a hard reset, a recursive delete outside the project, `sudo`, or a write to a device. The reason shows the command part. |
| Edit guard (`guard_edit`) | `tool.call` | none | Ask before an edit that removes test assertions, adds a skip marker, changes a generated file or a lockfile, or changes a Claude Code settings file. |
| Secret redaction (`guard_secrets`) | `tool.call` | `SECRET_SCAN_TIMEOUT_MS`, `SECRET_SCAN_MAX_BYTES` | Keep a secret in a tool result out of the context. Betterleaks finds it, and the result shows `[REDACTED:<rule>]`. |
| Spawn rules (`guard_agents`) | `agent.spawn` | `SUBAGENT_EFFORTS` | Keep the model and effort of a subagent within the [rules](#model-and-effort-rules). A call that asks for another model than the agent file fixes gets a deny with the reason. |
| Cold-cache note | `SessionStart` (resume), `prompt.submit` | `CACHE_TTL_MS` | Tell Claude that the prompt cache expired, so that it says what a handoff note and `/clear` can save. |
| Compaction | `session.compact` | `HANDOFF_FORK_TIMEOUT_MS` | Keep an unapproved plan or an open question open after a compaction, and keep the task state in a handoff note (`compaction_handoff`). |
| Working rules | `SessionStart` | `RULES_MAX_BYTES` | Give Claude the few rules that have a stated incident, in at most 2,000 bytes. |
| Handoff pointer | `SessionStart` | none | Point a new or cleared session to the newest handoff note with `status: in-progress`. |
| Verify gate | `Stop` | none | Send Claude back once when a turn edited files and no check ran after the last edit. |

The module `hooks/register.mjs` runs the first six rows through the Claude Code hooks module, so a tool call starts no process.
Where Claude Code does not load modules, such as with `--bare`, no guard runs.
The two classic hooks are `hooks/session-start/context.mjs` and `hooks/stop/verify.mjs`.

## Status line

| Part | Event | Bound in `_budget.mjs` | User need |
| --- | --- | --- | --- |
| `status-line/main.mjs` | `statusLine` | `MAIN_CONTEXT_TOKENS`, `AUTO_COMPACT_TOKENS`, `USAGE_LEVELS` | See the model and effort, the context against the compaction point, the cache expiry, and the 5-hour and weekly limits. It warns when the effort is above the rule of the model. |
| `status-line/subagents.mjs` | `subagentStatusLine` | `SUBAGENT_CONTEXT_TOKENS`, `REVIEWER_CONTEXT_TOKENS` | See the model and context of each running agent. |

`/dotclaude:setup` writes two stubs that run these scripts, because a status line command gets an empty `${CLAUDE_PLUGIN_ROOT}`.

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

Each agent has `maxTurns` in its file: 20 for `test-runner`, 40 for `investigator`, 60 for the others, and 80 for `implementer`.

## Model and effort rules

| Model | Efforts |
| --- | --- |
| Opus 5.5 | `low`, `medium`, `high` |
| Sonnet 5.5 | `low`, `medium` |
| Haiku 4.5 | none |

The profile sets `maxEffortLevel` to `high`, so `xhigh` and `max` stay blocked.
Fable 5.1 is not in `availableModels`, and a subagent never runs on it.
No hook event fires when the effort of the main session changes, so the status line warns and nothing denies.

## Runtime budget

Runtime JavaScript is all `.mjs` files in `hooks/`, `status-line/`, `skills/`, and `plugins/`.
`RUNTIME_JS_LINES` is 3,000, and `tests/budget.test.mjs` fails above it.
0.19.1 had 18,935 lines.
