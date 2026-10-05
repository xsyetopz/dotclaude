# Evals

This page shows what the dotclaude evals measure and what they do not show.
It holds the suite description and the compaction data.
Per-version runs are in [Evals history](Evals-History).
Labels: **measured** means a run on this machine, and **reported** means a claim from a user.

## Summary

- The suites ran on dotclaude 0.4 to 0.19.
  They test parts that 0.20.0 changed.
- The Sonnet `medium` against `high` numbers of 0.17.1 are the evidence for the 0.20.0 `reviewer` and `debugger` effort.
- On 30 blind, single-turn tasks, Opus 5.5 already behaves well, so dotclaude neither helps nor hurts measurably.
- Sonnet 5.5 passed the role cases as often as Opus 5.5 at 52% to 60% of the cost.
- Built-in compaction beats `fast-compact` for usage.
  0.19.0 removed the fast-compact integration.
- After four compactions, the share of needed tokens that a summary keeps falls from 49% to 57% to 42%.

## Compactions before a handoff

**Measured** on 2026-09-30 from local transcripts, with no Claude usage.
`bun tools/compaction-report.mjs --max-pre 135000` gives these numbers.
It splits each compacted main session into parts at its compactions.
A needed token is one that a tool result of an earlier part introduced.
Claude used it in the first 40 tool calls of a later part.
It was kept when the summary or the kept messages put it in view before the use.

The data are 14 sessions with the 150k `autoCompactWindow`, with up to 27 compactions:

| Part | Parts | Cost per call | Context after compaction | Kept |
| --- | ---: | ---: | ---: | ---: |
| before compaction 1 | 14 | $0.067 | none | none |
| after compaction 1 | 14 | $0.053 | 18k | 54% of 636 |
| after compaction 2 | 11 | $0.052 | 20k | 53% of 337 |
| after compaction 3 | 8 | $0.049 | 24k | 58% of 231 |
| after compaction 4 | 7 | $0.054 | 21k | 55% of 242 |
| after compaction 5 to 8 | 25 | $0.054 | none | 42% of 1084 |
| after compaction 9 to 14 | 25 | $0.051 | none | 46% of 1137 |

- The cost per call does not grow with the number of compactions.
  Each compaction starts again from 18k to 24k tokens.
- In the 7 sessions that passed four compactions, compactions 1 to 4 kept 49% to 57% of the needed tokens.
  Compactions 5 to 8 kept 42%.
  The drop is in the same sessions, so the mix of sessions does not explain it.
- Thus 0.19 set `COMPACTIONS_BEFORE_HANDOFF` to 4.
  A fifth compaction costs the same as a handoff, but it keeps fewer of the facts that Claude uses next.
- 0.20.0 removed that constant.
  The option `compaction_handoff` forks a handoff note at each automatic compaction of the main conversation.
  Since the change after 0.20.8, Claude then stops and tells the user to run `/clear`.
- The sample is small: 7 sessions in 3 projects.
  The kept share is a proxy for quality, not a measure of task success.
  The compactions ran without a handoff rule, so the measure does not show how a handoff note compares.

## Behavior evals

The suite `plugins/dotclaude/evals/` runs with `claude plugin eval`.
The command repeats each case without the plugin as a baseline.
It shows whether dotclaude changes the pass rate and the cost per pass.
The suite has 13 cases:

- 8 cases in 4 tiers from simple to complex, from the 0.17.0 rework
- 3 role cases from 0.17.1
- 2 agent role cases

| Tier | Cases | Task |
| --- | --- | --- |
| `tier-1` | `t1-fix`, `t1-false-alarm`, `t1-found-defect` | a one-file fix, a reported bug that does not exist, and a fix with a second bug in the same file |
| `tier-2` | `t2-feature` | a feature across two files, then a commit that leaves the user's note out |
| `tier-3` | `t3-wrong-cause`, `t3-reset-request` | a wrong named cause across modules, and a `git reset --hard` request over uncommitted work |
| `tier-4` | `t4-delegate`, `t4-handoff` | delegation to `implementer` and a handoff note |
| `tier-5` | `t5-review`, `t5-debug`, `t5-slice`, `t5-investigate`, `t5-web-research` | a review with planted defects. A failure from shared state. A specified feature across four files. A config value from three files and the git history. A default from the official Node.js docs |

The case `t4-slices` of the old layout tested a part that 0.20.0 removed.

### History of the suite

- 0.17.0 replaced the 16 old cases with 8 tiered tasks, because several old cases came right after the rule that they test.
- 0.18.1 removed `evals-heldout/` and the reply graders (`word-count` and `adverbs`).
  Their regex graders came from the failure reports, and the reports are not an acceptance suite.
- A case that remains is graded by a command result, not by the words of the reply.

## How to run

The procedure is in [Development](Development#evals).

| Step | Command or rule |
| --- | --- |
| Run the eval | `claude plugin eval` |
| Run the oracles | `bun plugins/dotclaude/evals/oracle.mjs <result.json>` |
| Report the results | `bun plugins/dotclaude/evals/report.mjs <result.json>` |

- Each code case has a hidden test oracle, `oracle.sh`, that the agent never sees.
  `claude plugin eval` has no grader that runs a command.
  Thus `oracle.mjs` runs each oracle after the eval, in a copy of the kept workspace, and adds an `oracle` grader.
- Graders marked `arm: with-only` check that a dotclaude part fired.
  The baseline arm does not score them.
- `report.mjs` reports each case as trials passed out of trials run.
  It adds a 95% Wilson interval and pass^k.
- The suite mean uses standard errors clustered by case.
  The effect of the plugin is the paired per-case difference.
- Per arm, the report gives the cost per pass: all spend, failed trials included, divided by the trials that passed.
  After the oracle step, it also reports the mean input, output, cache-read, and cache-write tokens.
- With 5 trials, a case that always passes still has a lower bound of 57%.

## What the evals do not show

- On 30 blind, single-turn tasks in small repositories, Opus 5.5 already behaves well.
  dotclaude neither helps nor hurts measurably.
- The measured gains come from cases written with the rules.
  They show that Claude follows the rules, not that the rules matter on real work.
- The removed held-out groups `a` to `c` were at their ceiling.
  They were a regression check and not a measure of benefit.
- The suite does not cover long sessions, compaction, corrections over several turns, or large repositories.
  A held-out run of 30 cases, 5 trials, and both arms cost about $54 and took 32 minutes.

## Related pages

- [Evals history](Evals-History)
- [Open items](Open-Items)
- [Plans and models](Plans-and-Models)
- [Development](Development#evals)
