# Hooks Module

Part of the [dotclaude documentation](README.md). Since 0.18, dotclaude is a
mod: `hooks/hooks.json` names the hooks module `hooks/register.mjs`, and most
hooks run in it. The evidence is in the [dossier](dossier/mods.md).

## Where Each Hook Runs

The module runs in the Claude Code process, so a tool call starts no hook
process. It uses only the native events of Claude Code:

| Work | Event |
| --- | --- |
| The guards, the PostToolUse actions, and the edit-miss lines | `tool.call`, `tool.check` |
| The subagent conventions and the running-agent count | `agent.spawn` |
| The subagent context, the running marker, and the main effort | `turn.step` |
| The usage notes on a prompt | `prompt.submit` |
| The saved prompts for the compaction carry-over | `session.compact` |
| The built-in agents that dotclaude replaces | `agent.offer` |
| The engine task reminders | `prompt.attachment` |

These hooks stay classic command hooks, because no native event can do their
work:

| Classic event | Why |
| --- | --- |
| `SessionStart` | `session.start` does not fire after `/clear`, `/resume`, or a compaction, and it cannot add context. |
| `Stop`, `SubagentStop` | `turn.complete` cannot send Claude back. |
| `TaskCompleted`, `StopFailure`, `PreModelSwitch`, `PostModelSwitch` | No native event exists. |
| `ConfigChange` | `config.set` sees only the `/config` rows. |

The module does not use the `classic.*` events. Where the built-in guard
`sec-default` loads (Team and Enterprise plans, and machines with managed
settings), it sends the `classic.*` events past the mods that a user
installs. A native event reaches dotclaude on every plan.

## Where Mods Are Off

Claude Code does not load a hooks module with `--bare`, in safe mode, in an
untrusted workspace, or with `disableAllHooks`, `allowManagedHooksOnly`, or
`allowManagedModsOnly`. Then no guard runs, and no PostToolUse, prompt, or
compaction action runs. The classic hooks above still run, unless
`disableAllHooks` also stops them. This is a maintainer's decision: a second
copy of each guard as a command hook would run twice where mods are on.

## Built-ins That dotclaude Replaces

- **Agents** (`agent_guidance`): the model is not offered the built-in
  `general-purpose`, `claude`, `Explore`, `Plan`, and `statusline-setup`
  agents. The `dotclaude:` agents have a model, effort, turn limit, and tool
  set for their job, the main conversation writes plans in plan mode, and
  `/dotclaude:setup` sets the status line. `claude-code-guide` stays. An agent
  of yours or of a plugin with one of these names stays.
- **Task reminders** (`gate_tasks`): the engine reminders to use the task
  tools are left out of the request. The open-task check at the end of a turn
  does that job, and the reminders add text to the context.
- **Settings profile**: the [optional switches](settings-profile.md) remove
  the bundled skills, `Explore` and `Plan`, `ReportFindings`, and other
  built-in features that cost context on each request.
- **Built-in mods**: dotclaude turns off none. `agents-md`, `diff`,
  `telemetry`, and `plugin-authoring` do work that dotclaude does not do.
  `you-should-know` is off by default. Keep it off: its side agent uses
  quota. To turn off a built-in mod, use `/plugin`, tab **Installed**, under
  **Built-in**.

## Differences From The Classic Hooks

- The module gets no `transcript_path`. The saved prompts come from the
  session messages, so the filter for meta messages is approximate.
- A failed tool call gives its error text from the tool result. The
  `is_interrupt` and `duration_ms` fields are not set.
- The module gets no permission mode. So a guard asks in auto, `dontAsk`,
  and `bypassPermissions` mode where a classic hook stayed quiet.
- An action that throws is skipped, and its error is not logged. The tool
  call continues, so a bug in a guard does not stop your work.
