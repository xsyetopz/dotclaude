# dotclaude

dotclaude is a small Claude Code plugin for software engineering.
It keeps only the parts that Claude Code does not cover: guards, model and effort rules, compaction and cold-cache notes, a status line, and role agents.
It optimizes for the most quality per unit of usage quota, not for speed.

[The wiki](https://github.com/xsyetopz/dotclaude/wiki) tells what each part does and why.
[Parts](https://github.com/xsyetopz/dotclaude/wiki/Parts) lists each part with its event and bound.
The evidence pages, from [Design](https://github.com/xsyetopz/dotclaude/wiki/Design) on, hold the measurements and sources.

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
| Guards | Ask before destructive commands and before edits that remove test assertions, change generated files, or write a redaction marker. Redact secrets from tool output. |
| Spawn rules | Deny a subagent spawn that breaks the model and effort rules. |
| Compaction | Keep an unapproved plan open, fork a handoff note, and tell the user to run `/clear`. |
| Cache notes | Tell Claude when the prompt cache expired. |
| CodeGraph | Add the callers and callees of a function, method, or class to a search for its name, in a project with a CodeGraph index. In a git repository with no index, tell Claude to run `codegraph init -y`, and ask the user before `codegraph init` and `codegraph uninit`. |
| Long runs | Tell Claude to time one run of a step of unknown speed, and to run long work in the background. |
| Setup notice | Tell the user once for each plugin version when the user setup differs from the profile, and recommend `/dotclaude:setup`. |
| Line breaks | Rewrap commit and `gh` messages with semantic line breaks by `sembr`, and give Claude the `sembr` text for prose that it wrote with breaks at a column. |
| Minimal code | Tell Claude to build the minimum, with the idea of Ponytail. |
| Status line | Model, effort, context against the compaction point, cache expiry, and usage limits. |
| Agents | `investigator`, `web-researcher`, `implementer`, `reviewer`, `debugger`, `test-runner`, `reverse-engineer`. |
| Skills | `/dotclaude:setup`, `/dotclaude:handoff`, `/dotclaude:contribute`. |
| Style | `Concise`. |

You can turn off each part in `/config` under dotclaude with the options `guard_bash`, `guard_edit`, `guard_secrets`, `guard_policy`, `guard_agents`, `codegraph`, `ponytail`, `compaction_handoff`, and `sembr`.
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

## Save weekly usage

Each turn reads the whole context again, so the size of the context sets the cost of a turn.

- At the end of a task, write a handoff note with `/dotclaude:handoff` and run `/clear`.
  `/compact` reads the whole context to write its summary, and `/clear` costs nothing.
- Change the model only right after `/clear`.
  A new model starts a new prompt cache, so the next turn writes the whole context again at full price.
  For this reason the profile does not use `opusplan`.
- To lower the cost of a task, lower the effort and keep the model.
- Keep `MEMORY.md` and `CLAUDE.md` short.
  They load at each start, and Claude Code loads only the first 200 lines or 25 KB of `MEMORY.md`.
  Setup lists the memory files to review.
- Old transcripts in `~/.claude/projects/` do not go into the context.
  They use only disk space, and the profile sets `cleanupPeriodDays` to 14.

Usage evidence: [Usage evidence](https://github.com/xsyetopz/dotclaude/wiki/Usage-Evidence#community-claims).

## Browser plugin

```text
/plugin install dotclaude-browser@dotclaude
```

The plugin loads the `drive-web-browser` skill.
It uses `agent-browser` by default.
Set its `backend` option to `cloakbrowser` to run `agent-browser` with the CloakBrowser binary on sites with bot detection.

## Jev plugin

```text
/plugin install dotclaude-jev@dotclaude
```

The plugin loads the `second-opinion` skill.
Claude uses it to get a second opinion from [TypeSafe Jev](https://docs.typesafe.ai/introduction) on a close call: a yes or no check, a pick from its options, or a rating.
It also checks your technical decisions.
When facts show that a decision causes defects, Claude tells you once and asks you to confirm, and your answer is final.
Jev is a decision model that gives probabilities, and it does not write text or answer for you.
Export `TYPESAFE_API_KEY` before Claude Code starts.
Each call sends the data of the decision to the TypeSafe API.

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

0.20.0 removed many 0.19 parts.
See its changelog entry for the list.
To try an unreleased checkout, run `claude --plugin-dir /path/to/dotclaude/plugins/dotclaude`.

## Development

`just check` runs lint, tests, and plugin validation.
`just sandbox` runs Claude Code with this checkout in a separate config.
See [Development](https://github.com/xsyetopz/dotclaude/wiki/Development) and [Sandbox](https://github.com/xsyetopz/dotclaude/wiki/Sandbox).

## License

[MIT](LICENSE).
