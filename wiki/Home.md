# Home

dotclaude is an opinionated Claude Code plugin for software engineering.
These pages tell what each part does and why it works that way.
If Claude does something because of dotclaude and you ask "why did you do that?", the answer is in one of these pages.
The [README](https://github.com/xsyetopz/dotclaude/blob/main/README.md) tells how to install the plugin.

## The position

dotclaude optimizes for the most quality per unit of usage quota.
It does not optimize for speed or for the volume of output.

- *Quality per quota over speed.*
  Usage limits are the constraint that stops work.
  dotclaude spends quota where it buys quality and removes spend that buys none.
  dotclaude locks fast mode off for this reason.
- *Quality over quantity.*
  One checked change is worth more than several unchecked changes.
  Claude reproduces a bug before it fixes the bug.
  Claude runs a check before it says "done", and it reports what it did not check.
- *Mechanisms over prose.*
  A rule that a hook enforces holds.
  A rule that only a prompt states did not hold in the measured week (see [Usage evidence](Usage-Evidence)).
  Prose stays only where no mechanism exists.
- *Evidence over habit.*
  Each bound comes from a measurement, an official source, or a reverse-read of the Claude Code binary.
  The [evidence pages](Design) label each fact with its source.
- *The user decides.*
  Hooks ask before hard-to-reverse or public actions.
  Hooks never approve anything.
  The settings profile shows every change and makes a backup before it writes.

## Where to read

Read only the page that answers your question.

### Start

- [Home](Home): the position and the source labels.

### Use

- [Parts](Parts): each part of 0.20.0, its event, its bound, and the need that it serves.
- [Contributions](Contributions): the `contribute` skill and drafts for other projects.

### Develop

- [Development](Development): commands, tests, evals, and release steps.
- [Sandbox](Sandbox): how to test a checkout in a separate Claude Code config.

### Evidence

- [Design](Design): design principles, enforced usage bounds, and rejected alternatives.
- [Usage evidence](Usage-Evidence): where one Max 20x week of usage went, and what that means on Pro.
- [Plans and models](Plans-and-Models): plan detection, prices, model fit, and effort.
- [Prompt surface](Prompt-Surface): what a request contains, the lean prompt, and the working rules.
- [Evals](Evals): the behavior eval suites and their results.
- [Claude mods](Claude-Mods): the plugin hooks modules of Claude Code, and the gaps.
- [Open items](Open-Items): work still to measure or decide.

### History

- [Release history](Release-History): what changed in each release, and why.
  The [CHANGELOG](https://github.com/xsyetopz/dotclaude/blob/main/CHANGELOG.md) lists the current release.

### Other

- [Attributions](Attributions): the projects whose ideas dotclaude reimplements.

## Source labels

The pages give the reason for each choice.
The evidence pages hold the proof, and each fact there has one of these labels.
A choice with no label is the maintainer's decision, and the page says so.

| Label | Source |
| --- | --- |
| official | Anthropic documentation or support pages |
| binary | read from the installed Claude Code bundle, never patched |
| capture | a request body that Claude Code sent to a local listener |
| measured | a run or a transcript scan on the maintainer's machine |
| reported | user reports, weighed by score and agreement |
| inference | a conclusion from the facts above |

The facts date from 2026-09-26 to 2026-10-04 and Claude Code 2.1.283 to 2.1.289.
Dollar figures are API-equivalent list prices.
How a subscription weights cache reads against output is not published.
