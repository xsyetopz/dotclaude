# Open items

This page lists the measures, decisions, and claims about dotclaude that are still open after 0.27.0.
Each open item has a reason and an owner.
The owner is the user or the next session.
Labels: **measured** means a run on this machine, and **reported** means a claim from a user.

## Summary

- 9 items are open.
- 9 items were closed or made moot by 0.27.0.
- 11 claims from users were checked and not acted on.

## Open items

| Item | Reason it is open | Owner | What would close it |
| --- | --- | --- | --- |
| The `context_management` hook in a live session | The lab tests pass, but on this machine the built-in guard `sec-default` loads, because the machine has managed settings, and it skips the hook (**measured**). Both fixes need `sudo` ([Claude mods](Claude-Mods#the-built-in-guard-sec-default)). | The user | Remove the managed settings files, or add `dotclaude` to managed `prependPlugins` from a local marketplace folder. Then check the system prompt in a sandbox session. |
| The mods API can change between releases | The hooks module uses `tool.check` and `prompt.section` of the mods API. The API is documented, but it is new, and a change can break `hooks/mod.mjs` with no compatibility layer. | The next session | Run `just lab` on each new Claude Code release before you move the pin. |
| A recursive `rm` in auto mode that no `if` filter matches | The auto-mode guard starts only for commands that start with `rm`, `sudo`, `xargs`, `gh`, `git clone`, `curl`, or `wget`. Other forms go to the classifier. | The next session | A list of the forms that reach the classifier, from a week of auto-mode sessions. |
| The 300K window | The window is a judgment from reports (rot "around 300-400K" on a 1M window, and "200K is the sweet spot"), not from a measure on this machine (**reported**). | The user | A week of sessions, then a look at where the quality drops and where sessions stop. |
| Usage report after a week on 0.27 | No week of 0.27 data exists yet. | The next session | Run `just usage --days 7` and compare it with [Usage evidence](Usage-Evidence). |
| A capability eval suite | 0.27.0 removed the evals, so no suite covers the behavior of the output style and the agents. | The user | A blind, frozen suite written before any run, for long sessions, corrections over several turns, and large repositories. |
| `implementer` on Opus 5.5 against Sonnet 5.5 | The runs on this machine had different tasks (see [Model fit](Plans-and-Models#model-fit)). The ProjectArchitect Bench A/B is outside evidence on a different harness with a private hard tier. | The user | Run both models on the same tasks. Anthropic recalibrated the effort levels of Sonnet 5.5, so also re-check the `medium` setting of the Sonnet agents. |
| Per-turn effort changes in one long-lived process | No data: each effort value in the transcripts of 2026-10-04 and 2026-10-05 is `medium`. | The next session | Measure the changes in one long-lived process. |
| A Bash read of a directory does not load its `CLAUDE.md` or path-scoped `.claude/rules` files | Open in Claude Code ([#90450](https://github.com/anthropics/claude-code/issues/90450)). Claude Code 2.1.288 loads rules on Write and Edit. | The user (a fix in Claude Code) | A fix in Claude Code. |

## Closed items

| Item | Closed by |
| --- | --- |
| The compaction handoff and its retention baseline | 0.27.0. Compaction is off, and the user writes each note. |
| A week with compaction at 150k | 0.27.0. The profile turns compaction off. |
| What the user does after a handoff note | 0.27.0. No hook tells the user to run `/clear`. |
| The line-break hook (`sembr`) | 0.27.0 removed it. |
| The behavior of the `tool.check` ask in auto mode on 2.1.292 | Measured on 2026-10-07: the classifier allowed the ask of the module, so 0.27.0 adds `hooks/auto-mode-guard.mjs`. Its classic ask stopped `rm -r` outside the project. |
| The stop at the 300K window | Measured on 2026-10-07: the turn ended with `blocking_limit`, and no compaction ran ([Design](Design#the-027-rebuild)). |
| The OpenSpec resume after `/clear` | Measured on 2026-10-07: `/opsx:apply` in a fresh session continued at the first unchecked task ([OpenSpec](OpenSpec#measured-flow)). |
| The session ledger race | 0.20.0 |
| The shape of a usage-limit hit | The transcripts of 2026-10-04. It is an `assistant` entry with `error` set to `rate_limit`, `isApiErrorMessage` set to true, `apiErrorStatus` 429, and the model `<synthetic>`. The usage report counts this shape. |

## Claims not acted on

| Claim | Finding |
| --- | --- |
| Two Max 5x plans against one Max 20x | One user reports that Max 20x gives about 1.7 times the weekly usage of Max 5x. Anthropic does not state a weekly ratio. 0.27.0 has no plan detection. |
| Auto mode's classifier sends the whole transcript on every Bash call | Not checked in the binary. |
| A Haiku ping keeps the cache warm | Caches are per model, so a Haiku request cannot keep an Opus or Fable cache warm. |
| A cold cache costs 10 times more on Opus and 40 times on Fable | The official cache prices do not produce these ratios. |
| A Sonnet session started 8 Fable agents on extra usage | One report. The 0.27 profile leaves Fable out of `availableModels`. |
| Opus 5.5 got worse after its release | Public trackers do not agree. One shows 103.8% of the score at release. The Reddit threads of 2026-10-03 report the same. They are in `external/2026-10-03/`, a local source of the maintainer. |
| A tool-call batching rule saves about 20% of tokens on Opus 5.5 | One user measured it, and a stronger wording made reviews worse. Claude Code already tells Claude to make independent calls together. |
| Non-Claude model serving (parts 04, 05, 23, and 29 of the external reports) | Quantization, routing, and serving of the models of other vendors are outside the reach of a plugin. |
| Refusals by a safety classifier | A plugin cannot change the classifier of the model or of the engine. |
| DensePack | A tool that a user built to save usage. No measurement shows that it helps, and it compresses text with loss. |
| Domain checklists | A checklist per field, such as security or accessibility. No evidence shows that a checklist raises the pass rate, and the reports are not a spec. |

## Related pages

- [Usage evidence](Usage-Evidence)
- [Eval history](Evals-History)
- [Plans and models](Plans-and-Models)
