# dotclaude

dotclaude is a small Claude Code plugin for software engineering.
It keeps only the parts that Claude Code does not cover: guards, model and effort rules, compaction and cold-cache notes, a verify gate, a status line, and role agents.
It optimizes for the most quality per unit of usage quota, not for speed.
The runtime JavaScript stays within 3,000 lines.

[The documentation](docs/README.md) tells what each part does and why.
[Parts](docs/parts.md) lists each part with its event and bound.
[The dossier](docs/dossier.md) holds the measurements and sources.

## Install

```text
/plugin marketplace add xsyetopz/dotclaude
/plugin install dotclaude@dotclaude
```

Requirements: Claude Code 2.1.289 or later, [Bun](https://bun.sh) 1.4.2 or later on `PATH`, and git.
The secret redaction needs `betterleaks` on `PATH`.
Without it, tool output passes through.

## Setup

Run `/dotclaude:setup` and restart Claude Code.
A plugin cannot set permissions, environment variables, or models.
The skill merges one profile into a settings file that you choose.
It shows each change and makes a backup first.
It also sets the status line and the subagent status line.

## Parts

| Part | What it does |
| --- | --- |
| Guards | Ask before destructive commands and before edits that remove test assertions or change generated files. Redact secrets from tool output. |
| Spawn rules | Deny a subagent spawn that breaks the model and effort rules. |
| Compaction | Keep an unapproved plan open, and fork a handoff note. |
| Cache notes | Tell Claude when the prompt cache expired. |
| Verify gate | Send Claude back once when it stops after an edit with no check. |
| Status line | Model, effort, context against the compaction point, cache expiry, and usage limits. |
| Agents | `investigator`, `web-researcher`, `implementer`, `reviewer`, `debugger`, `test-runner`, `reverse-engineer`. |
| Skills | `/dotclaude:setup`, `/dotclaude:handoff`, `/dotclaude:contribute`. |
| Style | `Concise`. |

You can turn off each guard in `/config` under dotclaude with the options `guard_bash`, `guard_edit`, `guard_secrets`, `guard_agents`, and `compaction_handoff`.
The guards run in a hooks module.
Where Claude Code does not load modules, such as with `--bare`, no guard runs.

## Model and effort rules

| Model | Efforts | Roles |
| --- | --- | --- |
| Opus 5.5 | `low`, `medium`, `high` | main session, `reverse-engineer` |
| Sonnet 5.5 | `low`, `medium` | all other agents except `test-runner` |
| Haiku 4.5 | none | `test-runner` |

The profile sets `maxEffortLevel` to `high`, and `availableModels` has no Fable.
A call that asks for another model than the agent file fixes gets a deny with the reason.

## Browser plugin

```text
/plugin install dotclaude-browser@dotclaude
```

The plugin loads the `drive-web-browser` skill.
It uses `agent-browser` by default.
Set its `backend` option to `cloakbrowser` to run `agent-browser` with the CloakBrowser binary on sites with bot detection.

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
   It also writes the status line stubs again, because they point to the plugin version.

0.20.0 removed many 0.19 parts.
See its changelog entry for the list.
To try an unreleased checkout, run `claude --plugin-dir /path/to/dotclaude`.

## Development

`just check` runs lint, tests, and plugin validation.
`just sandbox` runs Claude Code with this checkout in a separate config.
See [Development](docs/development.md) and [Sandbox](docs/sandbox.md).

## License

[MIT](LICENSE).
