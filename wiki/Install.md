# Install

Install the dotclaude marketplace, then each plugin that you want.
The core plugin is `dotclaude`.
`dotclaude-browser` and `dotclaude-jev` are optional.

## Before you begin

| Need | For | Note |
| --- | --- | --- |
| Claude Code 2.1.290 or later | all plugins | |
| [Bun](https://bun.sh) 1.4.2 or later on `PATH` | `dotclaude` | The hooks run with `bun`. |
| git | `dotclaude` | |
| `betterleaks` on `PATH` | secret redaction | Without it, tool output passes through. |
| `TYPESAFE_API_KEY` | `dotclaude-jev` | Export it before Claude Code starts. |

## Install the core plugin

1. Add the marketplace.

   ```text
   /plugin marketplace add xsyetopz/dotclaude
   ```

1. Install the plugin.

   ```text
   /plugin install dotclaude@dotclaude
   ```

1. Run the setup skill, and restart Claude Code.

   ```text
   /dotclaude:setup
   ```

A plugin cannot set permissions, environment variables, or models.
The setup skill merges one profile into a settings file that you choose.
It shows each change and makes a backup first.
It also sets the status line and the subagent status line.

## Install the browser plugin

```text
/plugin install dotclaude-browser@dotclaude
```

The plugin loads the `drive-web-browser` skill.
It uses `agent-browser` by default.
Set its `backend` option to `cloakbrowser` to run `agent-browser` with the CloakBrowser binary on sites with bot detection.
See [Browser](Browser).

## Install the Jev plugin

1. Export the key before Claude Code starts.

   ```bash
   export TYPESAFE_API_KEY=<your key>
   ```

1. Install the plugin.

   ```text
   /plugin install dotclaude-jev@dotclaude
   ```

Each call sends the data of the decision to the TypeSafe API.
See [Second opinion](Second-Opinion).

## Update

1. Update the marketplace and the plugin.

   ```bash
   claude plugin marketplace update dotclaude
   claude plugin update dotclaude@dotclaude
   ```

1. Restart Claude Code, because a running session keeps the old hooks and agents.
1. Read the new entry in the [CHANGELOG](https://github.com/xsyetopz/dotclaude/blob/main/CHANGELOG.md).
1. Run `/dotclaude:setup` again.
   It shows each change.

> **Warning:** Before 1.0, a release can change or remove behavior without a compatibility layer.
> Release 0.20.0 removed many 0.19 parts.

## Try an unreleased checkout

```bash
claude --plugin-dir /path/to/dotclaude/plugins/dotclaude
```

For a separate config, see [Sandbox](Sandbox).

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Session start says output passes through | `betterleaks` is not on `PATH`. Install it. |
| No guard runs | Claude Code does not load hooks modules in your mode, for example `--bare`. |
| Jev calls fail | `TYPESAFE_API_KEY` was not set when Claude Code started. Export it and restart. |

## Next steps

- [Quickstart](Quickstart): see what happens in a first session.
- [Options](Options): turn parts on and off.
- [Parts](Parts): see each part of the core plugin.
