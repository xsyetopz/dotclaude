# dotclaude Dossier: Evals

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

## 6. Compaction: fast-compact Against `/compact`

0.19.0 removed the fast-compact integration.
Users report that Jev compacts badly, and the eval below found Jev's picks no better than keeping the newest outputs.

Measured on 2026-09-27 from local transcripts, with no Claude usage.

**The fast-compact bench, on 28 local points** (20 answered):

- Upstream `fast-jev-compaction` kept 0% of old tool output.
- `fast-compact` keeps 55% of the size, 52% of the needed tokens, and 63% of
  the needed outputs.
- The same rule without Jev, with the newest outputs kept whole, keeps 58%,
  54%, and 63%.
- Jev's ranking scored AUC 0.51–0.55, near chance. "Largest first" scored
  0.74.

**Replay of 5 real compactions.** A needed token is a path, number, or
identifier of 8 or more characters that a tool result introduced and Claude
used within 40 calls after the compaction. The replay found 70.

| | Kept | Read again | Neither | Context left |
| --- | --- | --- | --- | --- |
| Built-in `/compact` | 28 (40%) | 26 (37%) | 16 (23%) | 18k–25k of about 970k tokens |
| fast-compact rule | 58 (83%) | 12 (17%) | – | 72–91% of characters |

- fast-compact is not a replacement for compaction. It trims only old tool
  output, so every later turn re-reads 72–91% of the context.
- It keeps 83% of the needed tokens, against 40% for the built-in summary.
- For usage, built-in compaction wins by far. Each extra read costs a few
  thousand tokens, against about 750k extra on every turn.
- Jev adds no measurable gain.
- The sample is small. The token label agreed with the bench's blind check
  71% of the time.

Compact while the cache is warm. After the TTL expires, compaction re-reads
the whole conversation without the cache (**reported**). The 200k
`autoCompactWindow` compacts during an active turn.

## 7. Behavior Evals

The suite runs with `claude plugin eval`, which repeats each case without the
plugin as a baseline.

| Suite | Cases | Author | What it can show |
| --- | ---: | --- | --- |
| `evals/` | 11 | the 0.17.0 rework, in 4 tiers from simple to complex, and 3 role cases from 0.17.1 | whether dotclaude changes the pass rate and the cost per pass |

0.17.0 replaced the 16 cases of `evals/` with 8 tiered tasks. The old cases
were circular: several came right after the rule that they test.
0.18.1 deleted `evals-heldout/` and the reply graders (`word-count` and
`adverbs`). Their regex graders came from the failure reports, and the
reports are not an acceptance suite.
A case that remains is graded by a command result, not by the words of the
reply.

| Tier | Cases | Task |
| --- | --- | --- |
| `tier-1` | `t1-fix`, `t1-false-alarm` | a one-file fix, and a reported bug that does not exist |
| `tier-2` | `t2-feature` | a feature across two files, then a commit that leaves the user's note out |
| `tier-3` | `t3-wrong-cause`, `t3-reset-request` | a wrong named cause across modules, and a `git reset --hard` request over uncommitted work |
| `tier-4` | `t4-delegate`, `t4-slices`, `t4-handoff` | delegation to `implementer`, the `slices` setup, and a handoff note |
| `tier-5` | `t5-review`, `t5-debug`, `t5-slice` | a review with planted defects, a failure from shared state, and a specified feature across four files |

Each code case has a hidden test oracle, `oracle.sh`, that the agent never
sees. `claude plugin eval` has no grader that runs a command. Thus
`bun evals/oracle.mjs <result.json>` runs each oracle after the eval in a copy
of the kept workspace and adds an `oracle` grader. Graders marked
`arm: with-only` check that a dotclaude part fired, and the baseline arm does
not score them.

`bun evals/report.mjs <result.json>` reports each case as trials passed out
of trials run, with a 95% Wilson interval and pass^k. The suite mean uses
standard errors clustered by case. The plugin's effect is the paired per-case
difference. Per arm, it reports the cost per pass: all spend, failed trials
included, divided by the trials that passed. After the oracle step, it also
reports the mean input, output, cache-read, and cache-write tokens. With 5
trials, a case that always passes still has a lower bound of 57%.

The results for 0.17.1 are below. The procedure is in
[development](../development.md#evals).

### Results For 0.4.0

These runs used the old `evals/` suite, Claude Code 2.1.283, and Opus 5.5 as
agent and judge.

- **`evals/`, 3 trials per arm:** paired difference +18%, 95% CI −2% to
  +38%. The largest gains were `question-confirmed-bug` (3/3 against 0/3)
  and `scope-follow-up` (2/3 against 0/3).
- **`evals-heldout/` (deleted in 0.18.1), 5 trials per arm:** 95% of trials passed with
  dotclaude. The paired difference was −1%, 95% CI −4% to +1%. 27 of 30 cases
  passed every trial in both arms.
- The one regression was an edit-guard bug, which 0.4.0 fixed.

### Model And Effort Sweep For 0.17.1

**measured:** the 8 `t*` cases, 3 trials per arm, dotclaude only, Claude Code
2.1.287, Sonnet 5.5 judge, effort from `CLAUDE_CODE_EFFORT_LEVEL`
(`evals/results/0.17.1-sweep/summary.md`).

| Arm | Passed | Cost per pass |
| --- | --- | --- |
| Haiku 4.5 | 17/24 | $0.14 |
| Sonnet 5.5 low, medium, high | 21, 20, 22 of 24 | $0.12 to $0.13 |
| Opus 5.5 low, medium, high | 20, 22, 22 of 24 | $0.20 to $0.22 |
| Opus 5.5 xhigh | 24/24 | $0.28 |

- Most `t1-false-alarm` failures were correct replies that showed the
  results but not the command. Without that case, every Sonnet and Opus arm
  passed 20 or 21 of 21.
- Haiku 4.5 failed on judgment cases and cost more per pass than Sonnet 5.5
  low. This supports Haiku only for `test-runner`.
- Opus 5.5 medium passed as many trials as high for less. This supports
  medium as the default.
- 3 trials give wide intervals. The arms from Sonnet 5.5 low to Opus 5.5
  xhigh do not differ significantly.

### Longer Opus And Sonnet Run For 0.17.1

**measured:** the 11 cases, with the 3 role cases, 10 trials per arm,
dotclaude only, Claude Code 2.1.287, Sonnet 5.5 judge
(`evals/results/0.17.1-long/summary.md`).

| Arm | Passed | Without `t1-false-alarm` | Cost per pass |
| --- | --- | --- | --- |
| Sonnet 5.5 medium | 98/110 | 98/100 | $0.12 |
| Sonnet 5.5 high | 99/110 | 99/100 | $0.13 |
| Opus 5.5 medium | 101/110 | 100/100 | $0.22 |
| Opus 5.5 high | 99/110 | 98/100 | $0.24 |

- Every arm passed the 3 role cases in 10 of 10 trials. The role cases do
  not separate the models.
- In `t1-false-alarm`, the correctness judge passed 40 of 40. The format
  judge failed 38 of 40, because the replies did not show the command.
- Sonnet 5.5 is at the ceiling on these tasks at 55% to 60% of the Opus 5.5
  cost. Opus 5.5 medium passed as many trials as high for less.
- The first `t5-debug` oracle failed 3 correct fixes that added a test. The
  oracle now fails only when a line of `client.test.mjs` is removed or
  changed.
- The run found a stop-hook bug. `node --test` was not a check, so 64 of 200
  code replies answered a false "no check ran" note. 0.17.1 fixes it. The
  extra turns make the costs a little high in every arm.

### Re-Run And Model Swap For 0.17.1

**measured:** the same 11 cases and arms after the fixes above
(`evals/results/0.17.1-rerun/summary.md`).

| Arm | Passed | Cost per pass |
| --- | --- | --- |
| Sonnet 5.5 medium | 109/110 | $0.10 |
| Sonnet 5.5 high | 107/110 | $0.12 |
| Opus 5.5 medium | 110/110 | $0.19 |
| Opus 5.5 high | 109/110 | $0.21 |

- The rule, set before the results: an Opus agent moves to Sonnet when
  Sonnet passes its role case within 1 in 10 trials of Opus, at 60% of the
  Opus cost per pass or less.
- `t5-review`: Sonnet 5.5 high passed 10 of 10 at 52% of the Opus 5.5 high
  cost. `t5-debug` and `t3-wrong-cause`: 20 of 20 against 19 of 20, at 54%.
  The first run gave 53% to 56%. Thus `reviewer` and `debugger` use Sonnet
  5.5 at `high` from 0.17.1.
- `investigator`, `web-researcher`, and `reverse-engineer` have no role
  case, so they keep Opus 5.5.
- 3 Sonnet replies to `t1-fix` ended with an offer. The output style now
  forbids an offer at the end. In 10 trials each after the change, Sonnet
  5.5 medium and high passed `t1-fix` 10 of 10.
- One Opus report was replaced by a short reply to a Stop hook note,
  because `claude -p` returns only the last message. The note now asks for
  the full report in the last message. A unit test covers this. The eval
  trace does not record Stop hook output, so the runs do not show it.
- The role cases are at the ceiling for both models. The swap is not tested
  on hard reviews or hard root causes. A reported private batch of hard
  tasks found Sonnet 5.5 high lower than Opus 5.5 medium
  ([Models](plans-and-models.md)).

### Planned: Compatibility Rule

A state-based eval for the working rule that keeps an old name only for a named consumer.
The task is a rename in a fixture project at a version before 1.0.
The oracle is the `git diff`: it must show no alias and no re-export of the old name.
The case is not written yet.

### What The Evals Do Not Show

- On 30 blind, single-turn tasks in small repositories, Opus 5.5 already
  behaves well. dotclaude neither helps nor hurts measurably.
- The measured gains come from cases written with the rules. They show that
  Claude follows the rules, not that the rules matter on real work.
- The deleted held-out groups `a` to `c` were at their ceiling, a regression
  check and not a measure of benefit.
- The suite does not cover long sessions, compaction, corrections over
  several turns, or large repositories. A held-out run of 30 cases, 5 trials,
  and both arms cost about $54 and took 32 minutes.

## 8. Compactions Before A Handoff

Measured on 2026-09-30 from local transcripts, with no Claude usage.
`bun scripts/compaction-report.mjs --max-pre 135000` gives these numbers. It
splits each compacted main session into parts at its compactions.

A needed token is a path, number, or identifier of 8 or more characters. A
tool result of an earlier part introduced it, and Claude used it in the first
40 tool calls of a later part. It was kept when the summary or the kept
messages put it in view before the use.

**14 sessions with the 150k `autoCompactWindow`** (up to 27 compactions):

| Part | Parts | Cost per call | Context after compaction | Kept |
| --- | ---: | ---: | ---: | ---: |
| before compaction 1 | 14 | $0.067 | – | – |
| after compaction 1 | 14 | $0.053 | 18k | 54% of 636 |
| after compaction 2 | 11 | $0.052 | 20k | 53% of 337 |
| after compaction 3 | 8 | $0.049 | 24k | 58% of 231 |
| after compaction 4 | 7 | $0.054 | 21k | 55% of 242 |
| after compaction 5 to 8 | 25 | $0.054 | – | 42% of 1084 |
| after compaction 9 to 14 | 25 | $0.051 | – | 46% of 1137 |

- The cost per call does not grow with the number of compactions. Each
  compaction starts again from 18k to 24k tokens.
- In the 7 sessions that passed four compactions, compactions 1 to 4 kept
  49% to 57% of the needed tokens, and compactions 5 to 8 kept 42%. The drop
  is in the same sessions, so the mix of sessions does not explain it.
- Thus `COMPACTIONS_BEFORE_HANDOFF` is 4. A fifth compaction costs the same
  as a handoff, but it keeps fewer of the facts that Claude uses next.
- The sample is small: 7 sessions in 3 projects. The kept share is a proxy
  for quality, not a measure of task success. The compactions ran without a
  handoff rule, so the measure does not show how a handoff note compares.
