# dotclaude

dotclaude is an opinionated Claude Code plugin for software engineering with
Claude Opus 5.5. It optimizes for the most quality per unit of usage quota,
not for speed or for the volume of output. Hooks enforce the rules that a
program can check. A replacement system prompt and an output style set the
other working rules. Agents and skills do review, delegated work, and
research.

Each choice has a reason and evidence. [The documentation](docs/README.md)
tells what each part does and why. [The dossier](docs/dossier.md) holds the
measurements and sources behind it. To ask Claude, say "why did you do that?"
The `explain-dotclaude` skill answers from these pages.

## The Position

- **Quality per quota over speed.** Usage limits are the constraint that
  stops work. Fast mode is locked off, because it gives the same quality at
  twice the price.
- **Quality over quantity.** Claude reproduces a bug before it fixes it, runs
  a check before it says "done", and reports what it did not verify.
- **Mechanisms over prose.** A rule that a hook enforces holds. A rule stated
  only in a prompt did not hold in the measured week.
- **Evidence over habit.** Each bound comes from a measurement, an official
  source, or a read of the Claude Code binary.
- **The user decides.** Hooks ask before hard-to-reverse or public actions,
  and they never approve anything.

## Install

```text
/plugin marketplace add xsyetopz/dotclaude
/plugin install dotclaude@dotclaude
```

Then run `/dotclaude:apply-settings-profile` and restart Claude Code. A plugin
cannot set permissions, environment variables, or models. This skill writes
them into a settings file that you choose. It shows the changes and makes a
backup first. See [Settings Profile](docs/settings-profile.md).

For the optional integrations (CodeGraph, tgrep, fast-compact, Betterleaks,
Ghidra, and the browser plugin), run
`/dotclaude:setup-integrations`, or ask Claude, for example "set up codegraph
for this project".

Browser automation and CAPTCHA OCR are in a separate plugin, so sessions
without a browser do not load them:

```text
/plugin install dotclaude-browser@dotclaude
```

Requirements: Claude Code 2.1.284 or later, [Bun](https://bun.sh) 1.4.2 or
later on `PATH`, and git.

## Update

```bash
claude plugin marketplace update dotclaude
claude plugin update dotclaude@dotclaude
```

1. Restart Claude Code. A running session keeps the old hooks, agents, and
   output style.
1. Read the new entry in [`CHANGELOG.md`](CHANGELOG.md). Before 1.0, a release
   can change or remove behavior without a compatibility layer.
1. Run `/dotclaude:apply-settings-profile` again. It shows every change and
   backs up the file. A notice at session start tells you when your settings
   are behind the plugin.

To try an unreleased checkout, run `claude --plugin-dir /path/to/dotclaude`.

## What It Does

### [Hooks](docs/hooks.md)

- **Guards** ask before destructive or public commands and before edits that
  remove test assertions. They deny recursive searches through build output,
  background commands that can wait on stdin, such as `codex exec`, and a
  subagent's change to the frozen test files of an agent loop. They redact
  secrets from tool output with Betterleaks.
- **Gates** send Claude back once when it stops without a check that ran,
  with open tasks, with an agent-loop slice that no reviewer read, or with a
  reply that only announces the next step. A task stays open once after a
  code edit that no check followed.
- **Context** hooks load the `CLAUDE.md` of directories that Bash reads, and
  restore your exact words after compaction.
- **Usage** hooks bound subagent context and turns, cap agents at 5 at once,
  deny an unchanged re-read and a foreground server or watcher, lock the
  model list, and tell Claude when a usage limit is near.

Before a contribution to a project that you do not own, the Bash guard
checks a [catalog of project AI policies](docs/contributions.md). It denies
the contribution when the project forbids AI work, and otherwise asks you.

You can turn off each hook in `/config` under dotclaude. Every dotclaude
message starts with `[dotclaude]`. To run a command that a guard denied, type
`! <command>`.

### [Models](docs/models.md)

Opus 5.5 for the session, Sonnet 5.5 for cheap delegated work, Haiku 4.5 for
the simplest tasks, and Fable 5.1 only for planning in the main conversation.
Fast mode is off, and `max` effort is blocked.

### [Working Rules](docs/working-rules.md)

The system prompt and the output style: reproduce before a fix, a minimal
diff, a check before "done", commits only when you ask, few subagents, and
reports that start with the outcome.

### [Agents And Skills](docs/agents-and-skills.md)

| Agent | Model, effort |
| --- | --- |
| `code-reviewer`, `security-reviewer`, `plan-reviewer`, `debugger`, `performance-engineer`, `reverse-engineer` | Opus 5.5, high |
| `test-writer`, `ci-investigator`, `dependency-auditor` | Opus 5.5, medium |
| `history-investigator`, `web-researcher` | Opus 5.5, low |
| `implementer`, `docs-writer`, `mechanical-worker`, `diff-reviewer` | Sonnet 5.5, medium |
| `test-runner`, `integration-setup` | Haiku 4.5 |

| Skill | Use |
| --- | --- |
| `/dotclaude:apply-settings-profile` | applies the settings profile |
| `/dotclaude:setup-integrations` | installs CodeGraph, tgrep, fast-compact, Betterleaks, Ghidra, and `dotclaude-browser` |
| `run-agent-loop` | runs a large change as slices with a diff-only reviewer and a frozen test oracle |
| `write-session-handoff` | writes a note that a fresh session can continue from |
| `explain-dotclaude` | answers "why did you do that?" from the documentation |
| `drive-web-browser`, `recognize-captcha` | browser automation and offline CAPTCHA OCR, in the optional `dotclaude-browser` plugin |

### [Status Line](docs/status-line.md)

Two rows: where the session works, and what it uses. The context bar measures
against the 150k handoff point. The cache part shows the minutes until the
prompt cache expires. Usage limits show from 75%, and their pace shows a
deficit (`▲`) or a reserve (`▼`). Short glyphs replace words, so the rows
stay compact. A row that is too wide continues on the
next row, so nothing is cut off.

### [Settings Profile](docs/settings-profile.md)

Compaction at 150k tokens, no background requests that re-read the context,
5 subagents at once, read denies for `.env` files and credentials, auto
memory off, and a shell launcher for the system prompt. Each setting has its
reason on the page.

## Development

`just check` runs lint, tests, and plugin validation. `just sandbox` runs
Claude Code with this checkout in a separate config. See
[Development](docs/development.md) and [Sandbox](docs/sandbox.md).

## License

[MIT](LICENSE)
