# Home

dotclaude is an opinionated Claude Code plugin marketplace for software engineering.
It keeps only the parts that Claude Code does not cover, and it optimizes for the most quality per unit of usage quota, not for speed.
If Claude does something because of dotclaude and you ask "why did you do that?", the answer is in these pages.

## What it does

- Asks before destructive commands and before edits that weaken tests.
- Redacts secrets from tool output.
- Denies a subagent spawn that breaks the model and effort rules.
- Writes a handoff note before a compaction, so a fresh session can continue.
- Tells Claude when the prompt cache expired.
- Shows model, effort, context, cache expiry, and usage limits in a status line.
- Adds optional plugins for a browser (`dotclaude-browser`) and a second opinion (`dotclaude-jev`).

## The position

| Position | What it means |
| --- | --- |
| Quality per quota over speed | Usage limits stop work. dotclaude spends quota where it buys quality, and it locks fast mode off. |
| Quality over quantity | One checked change is worth more than several unchecked changes. Claude reproduces a bug before it fixes it, and it reports what it did not check. |
| Mechanisms over prose | A rule that a hook enforces holds. A rule that only a prompt states did not hold in the measured week (see [Usage evidence](Usage-Evidence)). |
| Evidence over habit | Each bound comes from a measurement, an official source, or a reverse-read of the Claude Code binary. |
| The user decides | Hooks ask before hard-to-reverse or public actions, and they never approve anything. The setup skill shows every change and makes a backup first. |

## Next steps

| Page | Read it to |
| --- | --- |
| [Install](Install) | Install the marketplace and the plugins. |
| [Quickstart](Quickstart) | See what happens in a first session. |
| [Guards](Guards) | Learn what the guards ask about. |
| [Handoffs](Handoffs) | Carry work across `/clear`. |
| [Browser](Browser) | Drive a browser. |
| [Second opinion](Second-Opinion) | Get a second opinion from Jev. |
| [Contributions](Contributions) | Draft work for projects that you do not own. |
| [Options](Options) | Turn parts on and off. |
| [Parts](Parts) | Find each part, its event, and its bound. |
| [Terms of Use](Terms-of-Use) | Read the clauses that dotclaude gives to Claude. |
| [Development](Development) and [Sandbox](Sandbox) | Change dotclaude and test a checkout. |
| [Attributions](Attributions) | See the projects whose ideas dotclaude reimplements. |

## Concepts and evidence

| Page | What it holds |
| --- | --- |
| [Design](Design) | Design principles, enforced usage bounds, and rejected alternatives. |
| [Usage evidence](Usage-Evidence) | Where one Max 20x week of usage went, and what that means on Pro. |
| [Plans and models](Plans-and-Models) | Plan detection, prices, model fit, and effort. |
| [Prompt surface](Prompt-Surface) | What a request contains, the lean prompt, and the working rules. |
| [Evals](Evals) | The behavior eval suites and their results. |
| [Claude mods](Claude-Mods) | The plugin hooks modules of Claude Code, and the gaps. |
| [Open items](Open-Items) | Work still to measure or decide. |
| [Release history](Release-History) | What changed in each release, and why. |

The [CHANGELOG](https://github.com/xsyetopz/dotclaude/blob/main/CHANGELOG.md) lists the current release.

## Source labels

The evidence pages give the proof for each choice, and each fact there has one of these labels.
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
