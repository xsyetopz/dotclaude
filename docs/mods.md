# Hooks Module

Part of the [dotclaude documentation](README.md). Since 0.18, dotclaude is a
mod: `hooks/hooks.json` names the hooks module `hooks/register.mjs`, and most
hooks run in it. The evidence is in the [dossier](dossier/mods.md).

## Where Each Hook Runs

The module runs in the Claude Code process, so a tool call starts no hook
process. It uses only the native events of Claude Code:

| Work | Event |
| --- | --- |
| The guards, the PostToolUse actions, the edit-miss lines, and the `AskUserQuestion` notification | `tool.call`, `tool.check` |
| The subagent conventions and the running-agent count | `agent.spawn` |
| The subagent context, the running marker, and the main effort | `turn.step` |
| The usage notes on a prompt | `prompt.submit` |
| The saved prompts and the summary instructions for the compaction carry-over, and the optional handoff note | `session.compact` |
| The optional desktop notification at the end of a main turn | `turn.complete` |
| The built-in agents that dotclaude replaces | `agent.offer` |
| The engine task reminders and the silent-turn reminder | `prompt.attachment` |

These hooks stay classic command hooks, because no native event can do their
work:

| Classic event | Why |
| --- | --- |
| `SessionStart` | `session.start` does not fire after `/clear`, `/resume`, or a compaction, and it cannot add context. |
| `Stop`, `SubagentStop` | `turn.complete` cannot send Claude back. The module uses it only for the notification below. |
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

## Optional Features

All three options are on by default.
Each item below ran in a live sandbox session with Claude Code 2.1.288 on 2026-10-03.

- **Compaction handoff** (`context_compaction_handoff`): before a compaction of the main conversation, the module asks the main model for a handoff note with `$.model.fork`.
  The model sees the whole conversation, so the note can quote your requests.
  The module saves the note under `.claude/handoffs/`, and adds it as one row to the compacted conversation.
  If the model call fails or gives no answer, the compaction runs without the note.
  The module waits at most 60 seconds for the note, and then compacts without it.
  With `DOTCLAUDE_DEBUG` set, the reason goes to `handoff.log` in the state folder.
  The call costs one more model call on the full context.
  A subagent compaction gets no note.
- **Automatic clear** (`context_auto_clear`): from 100k tokens of main context (`CONTEXT_NOTE_TOKENS`), your next typed prompt starts a clear.
  The module writes a handoff note with the same fork, saves it as `…-clear.md`, and does not send the prompt.
  After the hook returns, the module runs `/clear` with `$.command.run`, and sends your prompt again with `$.prompt.submit`.
  The TUI shows that prompt as "Prompt from the dotclaude plugin", and the model reads it as your words.
  `$.prompt.submit` takes no context, so the `SessionStart` hook `point-to-handoff.mjs` adds the full note after the clear.
  It does this only for a `-clear.md` note that is at most 5 minutes old (`AUTO_CLEAR_NOTE_MAX_AGE_MS`).
  A prompt with attachments, a prompt that a plugin sends, or a prompt during a turn does not start a clear, because the module cannot send attachments again.
  If the fork fails, the prompt goes on with no clear.
  The first prompt after `--continue` or `--resume` gets no note (the fork has nothing to fork), so the clear starts at the second prompt.
  If the clear fails, the module still sends the prompt again.
  With the option off, the context note asks Claude for a handoff, as in [Usage Notes](hooks-usage.md#usage-notes-usage_notes).
- **Desktop notifications** (`notify_desktop`): the module shows a notification at the end of a main turn and when Claude asks a question with `AskUserQuestion`.
  The `Notification` hook `hooks/notification/notify-permission.mjs` shows one when Claude Code asks for a permission (`permission_prompt`).
  For a question dialog, the CLI sends the same `permission_prompt` message ("Claude needs your permission") with no tool name.
  So the module writes a question flag in the state folder while an `AskUserQuestion` call is open, and the hook sends nothing while the flag is set.
  Both use `terminal-notifier`, or `osascript` when that tool is not there.
  When neither exists, as on Linux, nothing shows and nothing fails.
  The text has the task, the short session ID, and the repository.
  A failed notification does not change the turn.
- **Reminder** (part of `notify_desktop`): each notification gets one reminder after `NOTIFY_REMINDER_MS` in `hooks/lib/_budget.mjs` (5 minutes), if you have not answered.
  For a turn end or a question, the module sets one timer.
  Your next prompt clears the timers, and the end of an `AskUserQuestion` call clears the timer of that question.
  A turn that you stop with Esc gets no notification, because you are at the terminal.
  A question that a guard denies gets no notification.
  For a permission notification, the hook writes a marker file in the state folder, and starts a detached child process (`hooks/lib/_remind-child.mjs`, no shell).
  The child waits, and sends the reminder only when its marker is still the newest one.
  A newer permission notice replaces the marker.
  The module tracks the calls that wait for a permission dialog.
  `tool.check` adds a call when its verdict is `ask`.
  The CLI logs each permission decision as a `tool_decision` record, before the tool runs.
  The module reads that record in a `telemetry.log` hook for `{ to: "collector" }`, and passes it on unchanged.
  The decision, or the end of the `tool.call` when no record comes, removes the call.
  The module clears the marker only when no call waits.
  So a tool that runs long after you approve it gets no reminder, and a parallel tool that ends does not clear the reminder of a dialog that still waits.
  Each prompt also clears the marker and the list.
  In the live session, the `tool_decision` record came before the tool ran, with the `tool_use_id` of the `tool.check` call.
  The detached child outlived the hook and sent the reminder, and Esc on a dialog cleared it.
  The `idle_prompt` type of the `Notification` hook is not used, because on macOS it needs accessibility permissions, and its idle time is a Claude Code setting that the bound cannot set.

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
- **Silent-turn reminder**: after five API calls with no text, the engine
  tells Claude to say what it does.
  dotclaude replaces that text.
  Claude gives a fact, a failure, or a change of plan in one sentence, or continues with no message.
  From 2026-10-02 to 2026-10-03, 93 of 189 messages that only named the next step came after this reminder.
- **Settings profile**: the [optional switches](settings-profile.md) remove
  the bundled skills, `Explore` and `Plan`, `ReportFindings`, and other
  built-in features that cost context on each request.
- **Built-in mods**: the setup switch `builtin-plugins` turns on
  `you-should-know` and turns off the other built-in mods that settings can
  switch. `you-should-know` is off by default, and its side agent uses
  quota. It runs with the `telemetry` mod off. To turn a built-in mod on or
  off, use `/plugin`, tab **Installed**, under **Built-in**.

## Differences From The Classic Hooks

- The module gets no `transcript_path`. The saved prompts come from the
  session messages, so the filter for meta messages is approximate.
- A failed tool call gives its error text from the tool result. The
  `is_interrupt` and `duration_ms` fields are not set.
- The module gets no permission mode. So a guard asks in auto, `dontAsk`,
  and `bypassPermissions` mode where a classic hook stayed quiet.
- An action that throws is skipped, and its error is not logged, because the
  module has no stderr.
  The tool call continues, so a bug in a guard does not stop your work.
  With `DOTCLAUDE_DEBUG` set, the error goes to the engine, which logs
  "hook failed" and runs the event without dotclaude.
