# Parts

This page lists each part of dotclaude 0.27.0, its file, its bound, and the need that it serves.
All bounds are in `plugins/dotclaude/lib/budget.mjs`.
Tests pin the copies of a bound in code and config.
Every path below is under `plugins/dotclaude/`.

## Core plugin

| Part | File | Bound in `budget.mjs` | What it does |
| --- | --- | --- | --- |
| Hooks module | `hooks/mod.mjs`, rules in `lib/guard.mjs` | `POLICY_TIMEOUT_MS` (5,000 ms), `POLICY_FILE_MAX_CHARS` (2,000) | A `tool.check` handler asks for a recursive `rm` outside the project, and asks once per session for a repository of another owner with a policy file. A `prompt.section` handler replaces `context_management` when `DISABLE_COMPACT` is set. See [Guards](Guards) and [Claude mods](Claude-Mods). |
| Auto-mode guard | `hooks/auto-mode-guard.mjs`, rules in `lib/guard.mjs` | `POLICY_TIMEOUT_MS` | A classic PreToolUse hook for auto mode only, because the classifier can allow an ask of the module. Needs Node.js. See [Guards](Guards#the-auto-mode-guard). |
| Output style | `output-styles/dotclaude.md` | `STYLE_MAX_BYTES` (6,000) | The forced style, with the sections `doing_tasks`, `verification`, `actions`, `context`, `subagents`, and `reports`. See [Prompt surface](Prompt-Surface). |
| Settings profile | `templates/settings.json` | `CONTEXT_WINDOW` (300,000), `USAGE_LEVELS` (75 and 90) | Environment, permission rules, the sandbox, models, and the 300K window. Applied by the setup skill. |
| Managed settings | `templates/managed-settings.json` | `CONTEXT_WINDOW` | Optional system-level lock. Has the window, no compaction, the sandbox with `failIfUnavailable`, `disableBypassPermissionsMode`, and the deny list. |
| Setup skill | `skills/setup/SKILL.md`, `skills/setup/scripts/settings.mjs` | none | Previews and applies the profile, and offers the OpenSpec install. See [Install](Install). |
| Handoff skill | `skills/handoff/SKILL.md` | none | Writes `.claude/handoffs/<slug>.md`. See [Handoffs](Handoffs). |
| Status line | `status-line/statusline.mjs` | `USAGE_LEVELS` | Model and effort, context against the window, the OpenSpec change, and the 5-hour limit. |
| Hook lab | `tests/mod.test.ts` | none | 8 tests of the module with stubbed events. Run with `just lab`. |

The skill file paths and the lab path come from the repository layout, and `just check` validates them.

## Agents

Each agent file is in `agents/`.
The model, effort, and turn limit of each agent are in `AGENTS` in `budget.mjs`.

| Agent | Model | Effort | `maxTurns` |
| --- | --- | --- | --- |
| `investigator` | Sonnet 5.5 | medium | 60 |
| `web-researcher` | Sonnet 5.5 | medium | 60 |
| `implementer` | Sonnet 5.5 | medium | 80 |
| `debugger` | Sonnet 5.5 | medium | 60 |
| `reviewer` | Opus 5.5 | high | 60 |
| `test-runner` | Haiku 4.5 | none | 20 |

Haiku 4.5 has no effort setting.
`SUBAGENT_EFFORTS` lists the efforts that each model accepts.

### Model and effort rules

| Model | Efforts |
| --- | --- |
| Opus 5.5 | low, medium, high, xhigh, max |
| Sonnet 5.5 | low, medium, high, xhigh, max |
| Haiku 4.5 | none |

The settings profile sets `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5-5`, so a subagent with no model of its own runs on Sonnet 5.5.
It denies `Agent(general-purpose)`.
It sets `CLAUDE_CODE_FORK_SUBAGENT=0`, and it caps concurrent subagents at 5.
It sets `maxEffortLevel` to `xhigh`, so `max` is not available in a session.
See [Plans and models](Plans-and-Models).

## Settings profile values

| Key | Value | Reason |
| --- | --- | --- |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | 300000 | The window of a session. |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | 300000 | The window that `/context` shows and warns against. Without it, Claude Code 2.1.292 uses 200K for Opus 5.5. |
| `DISABLE_COMPACT` | 1 | No compaction, and no `/compact`. |
| `autoCompactEnabled` | false | No automatic compaction. |
| `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` | 1 | The short built-in prompt. |
| `autoMemoryEnabled` | false | No auto memory. |
| `CLAUDE_CODE_DISABLE_FAST_MODE` | 1 | Fast mode stays off. |
| `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | 5 | The concurrency cap. |
| `model` | `claude-opus-5-5` | The main model. The profile has no advisor. |
| `enableArtifact`, `enableWorkflows` | false | Removes the Artifact and Workflow tools from each request. |
| `permissions.deny`: `ScheduleWakeup`, `ReportFindings` | | Removes two more unused tools. `/code-review` then gives its findings as text. |
| `promptCacheTtl` | `5m` | The cache time to live. |
| `cleanupPeriodDays` | 14 | Transcript retention. |
| `promptSuggestionEnabled`, `awaySummaryEnabled` | false | No background requests. |

The profile has no `effortLevel`.
Other keys, such as the feedback switches and `enableAllProjectMcpServers`, are in the file.

## Optional plugins

| Plugin | Files | What it does |
| --- | --- | --- |
| `dotclaude-browser` | `skills/` | The `drive-web-browser` skill, and a `backend` option. No hooks. See [Browser](Browser). |
| `dotclaude-jev` | `hooks/hooks.json`, `hooks/module/index.mjs`, `hooks/session-start/second-opinion.md` | A SessionStart note, and a Jev pick added to `AskUserQuestion`. See [Second opinion](Second-Opinion). |
| `dotclaude-modder` | `hooks/hooks.json`, `hooks/module/index.mjs`, `skills/mod-any-game/` | One skill, a deny for a kill by process name, and a `fal_key` option. No session note. See [Modder](Modder). |

## Related pages

- [Guards](Guards)
- [Handoffs](Handoffs)
- [Development](Development)
