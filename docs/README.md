# dotclaude Documentation

dotclaude is an opinionated Claude Code plugin for software engineering. These
pages tell what each part does and why it works that way. If Claude does
something because of dotclaude and you ask "why did you do that?", the answer
is in one of these pages.

## The Position

dotclaude optimizes for the most quality per unit of usage quota. It does not
optimize for speed or for the volume of output.

- **Quality per quota over speed.** Usage limits are the constraint that
  stops work. dotclaude spends quota where it buys quality and removes spend
  that buys none. Fast mode is locked off for this reason.
- **Quality over quantity.** One checked change is worth more than several
  unchecked ones. Claude reproduces a bug before it fixes it, runs a check
  before it says "done", and reports what it did not verify.
- **Mechanisms over prose.** A rule that a hook enforces holds. A rule stated
  only in a prompt did not hold in the measured week
  ([usage evidence](dossier/usage.md)). Prose stays only where no mechanism
  exists.
- **Evidence over habit.** Each bound comes from a measurement, an official
  source, or a reverse-read of the Claude Code binary. The
  [dossier](dossier.md) labels each fact with its source.
- **The user decides.** Hooks ask before hard-to-reverse or public actions.
  They never approve anything. The settings profile shows every change and
  makes a backup before it writes.

## Pages

| Page | What and why |
| --- | --- |
| [Parts](parts.md) | each part of 0.20.0, its event, its bound, and the need that it serves |
| [Contributions](contributions.md) | the `contribute` skill and drafts for other projects |
| [Development](development.md) | commands, tests, evals, and release steps |
| [Sandbox](sandbox.md) | how to test a checkout in a separate Claude Code config |
| [Attributions](attributions.md) | the projects whose ideas dotclaude reimplements |
| [Dossier](dossier.md) | the measurements, sources, and rejected alternatives behind the choices |
| [Changelog](../CHANGELOG.md), [older releases](changelog/) | what changed in each release, and why |

0.20.0 removed the 0.19 pages for hooks, models, working rules, agents and skills, settings profile, status line, and organizations.
The [older releases](changelog/) and the [dossier](dossier.md) keep the 0.19 text as history.

## Source Labels

The pages give the reason for each choice. The dossier holds the evidence, and
each fact there has one of these labels: **official** (Anthropic
documentation), **binary** (read from the installed Claude Code bundle),
**capture** (a request that Claude Code sent), **measured** (a run or a
transcript scan), **reported** (user reports, weighed by agreement), or
**inference** (a conclusion from the other facts). A choice with no label is
the maintainer's decision, and the page says so.
