# Status Line

Part of the [dotclaude documentation](README.md). The status line measures
the session against dotclaude's own bounds, not against the model's limits.
It shows what you need to decide when to hand off, compact, or stop.

## Main Status Line

The first row shows where the session works:

- the folder below the project and the added directories, the worktree, the
  git branch with changed files and commits ahead or behind, and the pull
  request number as a link
- the `--agent` name, the vim mode, and the session name

The second row shows what the session uses:

- the model with its effort, and the context against the 200k handoff point,
  with a bar that turns yellow at 75% and red at 90%, and `handoff` past it
- the prompt cache: the time it expires, its hit ratio, and its misses with
  the last cause, or the tokens that the next turn re-reads when it is cold
  on 100k or more
- the 5-hour, weekly, and spend limits with their reset times from 75%, or
  the session cost when you pay per token
- the lines added and removed, and the session time

## Why Each Part

- **Context against 200k, not the model's window:** the settings profile
  compacts at 200k, and calls over 150k tokens were 74.7% of the measured
  cost ([usage evidence](dossier/usage.md)). A bar against a 1M window stays
  near empty while usage climbs.
- **Cache expiry and misses:** a prompt after the cache expired writes the
  whole context to the cache again. When you see the expiry time, you can
  answer before it or decide on a handoff. The miss cause tells you what broke
  the cache, for example a model or effort change
  ([prices](dossier/plans-and-models.md#prices)).
- **Limits from 75%:** the same levels as the
  [usage notes](hooks.md#usage-notes-usage_notes). Below 75% a limit does not
  change what you do, so it takes little space.
- **Place, agent, and session name:** with several sessions and worktrees
  open, the row tells you which one you are in before you approve an action.
- **Lines and time:** the size of the change and how long the session ran,
  for a quick check against what you asked for.

## Wrapping

Each row that is too wide for the terminal continues on the next row, so no
part is cut off. Past three rows, parts drop by priority, the lowest first.
A limit at 75% or more gets a high priority and stays.

**Why:** Claude Code cuts a status line that is wider than the terminal. A
cut line can drop the part you need. The limit of three rows is the
maintainer's decision, so that the status line does not take the space of
the conversation.

## Refresh

The `statusLine` setting has `refreshInterval: 60`. Claude Code runs the
command again every 60 seconds, also while the session is idle.

**Why:** without it, the status line runs only on events. An idle session
then shows a stale session time and cache expiry. Each run starts `bun` and
one `git status`. Once a minute matches the display, which shows minutes, and
spawns no more often than that.

## Subagent Rows

Each subagent row shows the agent, its model and effort, its context against
the 150k subagent budget, and its run time. The plugin sets these rows
through a stub that session start writes to
`~/.claude/dotclaude/subagent-statusline.mjs`.

**Why a stub:** Claude Code leaves `${CLAUDE_PLUGIN_ROOT}` empty in the
`subagentStatusLine` command, and the plugin's directory changes with every
version. The stub is at a fixed path, and session start keeps it pointing at
the current version.

## Install

A plugin cannot set the main status line, so the settings profile skill
offers it. It writes a small stub to `~/.claude/dotclaude/statusline.mjs`.
Session start keeps the stub pointing at the current plugin version. To
install or remove it yourself, run one of these in the plugin directory:

```sh
bun skills/apply-settings-profile/scripts/apply-statusline.mjs --apply
bun skills/apply-settings-profile/scripts/apply-statusline.mjs --remove --apply
```

Run `--apply` again after an update to add new settings such as
`refreshInterval` to an existing install.
