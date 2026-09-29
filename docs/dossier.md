# dotclaude Dossier

This dossier records why dotclaude works the way it does. It holds the design
decisions, the measurements behind them, and the open questions.
[`README.md`](../README.md) tells you how to install the plugin. The
[documentation](README.md) tells you what each part does and why, and links
here for the evidence.
[`CHANGELOG.md`](../CHANGELOG.md) tells you what changed in each release.

## Contents

Read only the part that answers your question.

| # | Part | Read it for |
| --- | --- | --- |
| 1–2 | [Design](dossier/design.md) | design principles, enforced usage bounds and their tests, turn-limit handoff, the agent loop, rejected alternatives |
| 3 | [Usage Evidence](dossier/usage.md) | where one Max 20x week of usage went, what that means on Pro, turns against tool calls |
| 4 | [Plans And Models](dossier/plans-and-models.md) | the Fable limit, plan detection, per-plan policy, prices, model fit, effort |
| 5 | [Claude Code Prompt Surface](dossier/prompt-surface.md) | what a request contains, the lean prompt, the system prompt launcher, output styles, tool removal |
| 6–7 | [Evals](dossier/evals.md) | fast-compact against `/compact`, the behavior eval suites and their results |
| 8–9 | [Open Items](dossier/open-items.md) | work still to measure or decide, reported claims that dotclaude does not act on |

## Sources

The facts date from 2026-09-26 to 2026-09-29 and Claude Code 2.1.283 to
2.1.284. Each
fact carries one of these source labels:

| Label | Source |
| --- | --- |
| official | Anthropic documentation or support pages |
| binary | read from the installed Claude Code bundle, never patched |
| capture | a request body that Claude Code sent to a local listener |
| measured | a run or a transcript scan on the maintainer's machine |
| reported | Reddit threads, weighed by score and agreement |
| inference | a conclusion from the facts above |

Dollar figures are API-equivalent list prices. How a subscription weights
cache reads against output is not published.
