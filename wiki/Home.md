# Home

dotclaude is an opinionated Claude Code plugin marketplace for software engineering.
It keeps only the parts that Claude Code does not cover, and it optimizes for the most quality per unit of usage quota, not for speed.
Since 0.27 the core plugin uses only official extension points: settings, permission rules, the sandbox, one output style, agents, skills, and one hooks module.
If Claude does something because of dotclaude and you ask "why did you do that?", the answer is in these pages.

## What it does

- Sets permission rules and the sandbox, so that Claude Code asks before destructive, public, and secret-reading actions.
- Asks before a recursive `rm` outside the project, and before the first contact with a repository of another owner that has an AI policy file.
- Turns off compaction and sets a 300K context window, so that a session stops at the limit and you start fresh with `/clear`.
- Forces one output style over the simple system prompt.
- Gives Claude six agents with a model, an effort, and a turn limit each.
- Writes a handoff note on request (`/dotclaude:handoff`), and works with [OpenSpec](OpenSpec) for the task list.
- Shows model, effort, context, the OpenSpec change, and the 5-hour limit in a status line.
- Adds optional plugins for a browser (`dotclaude-browser`), a second opinion (`dotclaude-jev`), and game modding (`dotclaude-modder`).

## The position

| Position | What it means |
| --- | --- |
| Quality per quota over speed | Usage limits stop work. dotclaude spends quota where it buys quality, and it locks fast mode off. |
| Quality over quantity | One checked change is worth more than several unchecked changes. Claude reproduces a bug before it fixes it, and it reports what it did not check. |
| Official points over runtime code | When Claude Code has a setting, a rule, or a hook for a need, dotclaude uses it and writes no runtime code. |
| Evidence over habit | Each bound comes from a measurement, an official source, or a reverse-read of the Claude Code binary. |
| The user decides | Rules ask before hard-to-reverse or public actions, and they never approve anything. The setup skill shows every change and makes a backup first. |

## Next steps

| Page | Read it to |
| --- | --- |
| [Install](Install) | Install the marketplace and the plugins. |
| [Quickstart](Quickstart) | See what happens in a first session. |
| [Guards](Guards) | Learn what asks, what denies, and what the sandbox does. |
| [Handoffs](Handoffs) | Carry work across `/clear`. |
| [OpenSpec](OpenSpec) | Keep the task list in OpenSpec. |
| [Browser](Browser) | Drive a browser. |
| [Second opinion](Second-Opinion) | Get a second opinion from Jev. |
| [Modder](Modder) | Mod a PC game that you own. |
| [Contributions](Contributions) | Draft work for projects that you do not own. |
| [Parts](Parts) | Find each part, its file, and its bound. |
| [Development](Development) and [Sandbox](Sandbox) | Change dotclaude and test a checkout. |
| [Attributions](Attributions) | See the projects whose ideas dotclaude reimplements. |

## Concepts and evidence

| Page | What it holds |
| --- | --- |
| [Design](Design) | The 0.27 rebuild, design principles, and rejected alternatives. |
| [Usage evidence](Usage-Evidence) | Where one Max 20x week of usage went, and what that means on Pro. |
| [Plans and models](Plans-and-Models) | Prices, model fit, and effort. |
| [Prompt surface](Prompt-Surface) | What a request contains, the simple prompt, and the forced style. |
| [Eval history](Evals-History) | The behavior eval suites of the 0.4 to 0.26 releases. |
| [Claude mods](Claude-Mods) | The plugin hooks modules of Claude Code, and the gaps. |
| [Open items](Open-Items) | Work still to measure or decide. |
| [Release history](Release-History) | What changed in each older release, and why. |

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

The 0.27 facts date from Claude Code 2.1.292.
The older evidence dates from 2026-09-26 to 2026-10-04 and Claude Code 2.1.283 to 2.1.289.
Dollar figures are API-equivalent list prices.
How a subscription weights cache reads against output is not published.
