# Options

This page lists each user option of the three dotclaude plugins.
Each option is a `userConfig` entry of a plugin manifest.

## Set an option

1. Open `/config`.
1. Find the plugin name, such as `dotclaude`.
1. Change the option.

Hooks read an option as `CLAUDE_PLUGIN_OPTION_<NAME>`, with the name in upper case.
A boolean option is on unless you set it to `false`.

## dotclaude

All options are boolean, and the default is `true`.

| Option | What it does | Clause |
| --- | --- | --- |
| `guard_bash` | Asks before destructive `git`, file system, and device commands, `sudo`, a read of a secret file, a git hook bypass, a publish, a `gh` write, and a database delete. Also covers the Claude trailer check and the `codegraph init` ask. | 1, 3, 12 |
| `guard_edit` | Asks before an edit that deletes test assertions, adds skip markers, touches generated files, or edits Claude settings files. | 1 |
| `guard_secrets` | Replaces each secret in a tool result with `[REDACTED:<rule>]`. Needs `betterleaks` on `PATH`. | 1 |
| `guard_policy` | Asks before the first call that reaches a project of another owner with an AI policy file. Needs `gh` for GitHub fetches. | 14 |
| `guard_agents` | Denies a subagent spawn that breaks the model and effort rules. | 1 |
| `codegraph` | Adds callers and callees to a search for one symbol name, and tells Claude to run `codegraph init` in a git repository without an index. Needs `codegraph` on `PATH`. | 8, 12 |
| `ponytail` | At session start, tells Claude to build the minimum code. | 2 |
| `compaction_handoff` | Before an automatic compaction, writes a handoff note, then stops and tells you to run `/clear`. | 6 |
| `sembr` | Rewraps commit and `gh` messages with semantic line breaks, and adds a note after an edit of prose that breaks at a column. Needs `sembr` on `PATH`. | 11 |

## dotclaude-browser

| Option | What it does | Default |
| --- | --- | --- |
| `backend` | `agent-browser`, or `cloakbrowser` for sites with bot detection. | `agent-browser` |

## dotclaude-jev

The plugin has no `userConfig` option.
It reads one environment variable.

| Name | What it does | Default |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | The TypeSafe API key. Export it before Claude Code starts. | Not set, so Jev does nothing. |

## Related pages

- [Guards](Guards)
- [Handoffs](Handoffs)
- [Browser](Browser)
- [Second opinion](Second-Opinion)
