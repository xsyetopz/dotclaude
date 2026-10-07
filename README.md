# dotclaude

dotclaude is a Claude Code plugin for software engineering on official extension points.
It turns compaction off, sets a 300K context window, asks only before dangerous commands,
replaces the coding part of the system prompt with a short output style,
and keeps the state of long work in OpenSpec changes and handoff notes across `/clear`.
It optimizes for the most quality per unit of usage quota, not for speed.

[The wiki](https://github.com/xsyetopz/dotclaude/wiki) tells what each part does and why.
[Parts](https://github.com/xsyetopz/dotclaude/wiki/Parts) lists each part with its file and bound.
[Design](https://github.com/xsyetopz/dotclaude/wiki/Design) gives the source of each design claim.

## Install

```text
/plugin marketplace add xsyetopz/dotclaude
/plugin install dotclaude@dotclaude
```

Requirements: Claude Code 2.1.292, [Node.js](https://nodejs.org) 22.18 or later on `PATH`, and git.
The hooks module uses the mods API of Claude Code, which can change between releases,
so this release is tested only on 2.1.292.

## Setup

Run `/dotclaude:setup` and restart Claude Code.
A plugin settings file can set only `agent` and `subagentStatusLine`,
so the skill merges the profile into a settings file that you choose.
It shows each change and makes a backup first.
It also checks OpenSpec and offers to install it and to run `openspec init --tools claude`.

## Parts

| Part | What it does |
| --- | --- |
| No compaction | `autoCompactEnabled: false` and `DISABLE_COMPACT=1`, which also turns off `/compact`. |
| Window | `CLAUDE_CODE_MAX_CONTEXT_TOKENS=300000` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000`. At the limit the session stops, and you run `/clear`. |
| No auto memory | `autoMemoryEnabled: false`. Handoff notes and OpenSpec hold the state. |
| System prompt | `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1` and the forced `dotclaude` output style, which replaces the built-in coding instructions. |
| Permissions | Deny secret reads and disk wipes. Ask before force pushes, history rewrites, piped shells, `sudo`, publishes, public `gh` writes, and SQL drops. Allow read-only git and the usual build and test commands. |
| Sandbox | Bash runs in the sandbox, with network access only to GitHub and the package registries. |
| Guard | One hooks module asks before a recursive `rm` outside the project, and before the first call to a GitHub repository of another owner with an AI policy. |
| Status line | Model, effort, context against the window (yellow at 75%, red at 90%), the 5-hour limit, and the active OpenSpec change with its task count. |
| Agents | `investigator`, `web-researcher`, `implementer`, `debugger`, `reviewer`, `test-runner`. |
| Skills | `/dotclaude:setup`, `/dotclaude:handoff`. |

The plugin has no options.
To drop a part of the profile, see the setup skill.

## Models and effort

| Model | Roles | Effort |
| --- | --- | --- |
| Opus 5.5 | main session, `reviewer` | default `medium`, `reviewer` `high` |
| Sonnet 5.5 | `investigator`, `web-researcher`, `implementer`, `debugger` | `medium` |
| Haiku 4.5 | `test-runner` | none |

The profile sets no effort level, so each model keeps its default.
`maxEffortLevel` is `xhigh`, so `/effort` can go up for a hard check.

## Long work without compaction

Each turn reads the whole context again, so the size of the context sets the cost of a turn.

- For work of more than one session, start an OpenSpec change with `/opsx:propose`.
  After `/clear`, `/opsx:apply` continues at the first unchecked task.
- Before `/clear`, run `/dotclaude:handoff` to write the goal, the decisions, and the proof
  to `.claude/handoffs/<slug>.md`.
  Start the next session with `@.claude/handoffs/<slug>.md`.
- Change the model only right after `/clear`,
  because a new model starts a new prompt cache.
  An effort change keeps the cache.

See [Handoffs](https://github.com/xsyetopz/dotclaude/wiki/Handoffs)
and [OpenSpec](https://github.com/xsyetopz/dotclaude/wiki/OpenSpec).

## Add-on plugins

Each add-on works without the core plugin.

```text
/plugin install dotclaude-browser@dotclaude
/plugin install dotclaude-jev@dotclaude
/plugin install dotclaude-modder@dotclaude
```

- `dotclaude-browser` has the `drive-web-browser` skill.
  It uses `agent-browser`, and its `backend` option selects CloakBrowser for sites with bot detection.
- `dotclaude-jev` has the `second-opinion` skill,
  which asks [TypeSafe Jev](https://docs.typesafe.ai/introduction) for probabilities on a close call.
  Export `TYPESAFE_API_KEY` before Claude Code starts.
  Each call sends the data of the decision to the TypeSafe API.
- `dotclaude-modder` lets Claude mod a PC game that you own.
  It is a port of [universal-modder](https://github.com/rehan-remade/universal-modder) by Rehan,
  and it needs Bun and `uv`.
  It adds one skill and the fal MCP server, so install it only where you mod games.
  For reverse engineering, use the skills in [xsyetopz/skills](https://github.com/xsyetopz/skills).
  See [Modder](https://github.com/xsyetopz/dotclaude/wiki/Modder).

## Update

```bash
claude plugin marketplace update dotclaude
claude plugin update dotclaude@dotclaude
```

1. Restart Claude Code, because a running session keeps the old hooks and agents.
1. Read the new entry in [`CHANGELOG.md`](CHANGELOG.md).
   Before 1.0, a release can change or remove behavior without a compatibility layer.
1. Run `/dotclaude:setup` again.
   It shows each change.

0.27.0 is a rebuild that removes most 0.26 parts.
See its changelog entry for the list.
To try an unreleased checkout, run `claude --plugin-dir /path/to/dotclaude/plugins/dotclaude`.

## Development

`just check` runs lint, tests, plugin validation, and the hook lab.
`just sandbox` runs Claude Code with this checkout in a separate config.
See [Development](https://github.com/xsyetopz/dotclaude/wiki/Development)
and [Sandbox](https://github.com/xsyetopz/dotclaude/wiki/Sandbox).

## License

[MIT](LICENSE).
