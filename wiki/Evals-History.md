# Evals history

This page holds the per-version eval runs and the compaction bench.
The suite and the current method are in [Evals](Evals).
Labels: **measured** means a run on this machine, and **reported** means a claim from a user.

## Summary

| Run | Result |
| --- | --- |
| fast-compact bench (2026-09-27) | Built-in `/compact` wins for usage. Jev adds no gain. |
| 0.4.0 | Paired difference +18% on `evals/`, -1% on `evals-heldout/`. |
| 0.17.1 sweep | Opus 5.5 `medium` passed as many trials as `high` for less. Haiku 4.5 fits only `test-runner`. |
| 0.17.1 long run | Sonnet 5.5 is at the ceiling at 55% to 60% of the Opus 5.5 cost. |
| 0.17.1 re-run | `reviewer` and `debugger` moved to Sonnet 5.5. |
| Agent role cases | Written, not measured. |

## Compaction: fast-compact against `/compact`

0.19.0 removed the fast-compact integration.
Users report that Jev compacts badly.
The eval found Jev's picks no better than keeping the newest outputs.
**Measured** on 2026-09-27 from local transcripts, with no Claude usage.

The fast-compact bench used 28 local points (20 answered):

- Upstream `fast-jev-compaction` kept 0% of old tool output.
- `fast-compact` keeps 55% of the size, 52% of the needed tokens, and 63% of the needed outputs.
- The same rule without Jev, with the newest outputs kept whole, keeps 58%, 54%, and 63%.
- Jev's ranking scored AUC 0.51 to 0.55, near chance.
  "Largest first" scored 0.74.

A needed token is a path, number, or identifier of 8 or more characters.
A tool result introduced it, and Claude used it within 40 calls after the compaction.
The replay of 5 real compactions found 70 needed tokens.

| | Kept | Read again | Neither | Context left |
| --- | --- | --- | --- | --- |
| Built-in `/compact` | 28 (40%) | 26 (37%) | 16 (23%) | 18k to 25k of about 970k tokens |
| fast-compact rule | 58 (83%) | 12 (17%) | none | 72% to 91% of characters |

- fast-compact is not a replacement for compaction.
  It trims only old tool output, so every later turn re-reads 72% to 91% of the context.
- It keeps 83% of the needed tokens, against 40% for the built-in summary.
- For usage, built-in compaction wins by far.
  Each extra read costs a few thousand tokens, against about 750k extra on every turn.
- Jev adds no measurable gain.
- The sample is small.
  The token label agreed with the blind check of the bench 71% of the time.

Compact while the cache is warm.
After the TTL expires, compaction re-reads the whole conversation without the cache (**reported**).
The 200k `autoCompactWindow` of that time compacted during an active turn.
The 0.20.0 profile sets 150k.

## Results for 0.4.0

These runs used the old `evals/` suite, Claude Code 2.1.283, and Opus 5.5 as agent and judge.

- **`evals/`, 3 trials per arm:** the paired difference was +18%, 95% CI -2% to +38%.
  The largest gains were `question-confirmed-bug` (3/3 against 0/3) and `scope-follow-up` (2/3 against 0/3).
- **`evals-heldout/` (removed in 0.18.1), 5 trials per arm:** 95% of trials passed with dotclaude.
  The paired difference was -1%, 95% CI -4% to +1%.
  27 of 30 cases passed every trial in both arms.
- The one regression was an edit-guard bug, which 0.4.0 fixed.

## Model and effort sweep for 0.17.1

**Measured:** the 8 `t*` cases, 3 trials per arm, dotclaude only, Claude Code 2.1.287, and a Sonnet 5.5 judge.
Effort came from `CLAUDE_CODE_EFFORT_LEVEL`.
The summary is `evals/results/0.17.1-sweep/summary.md`.

| Arm | Passed | Cost per pass |
| --- | --- | --- |
| Haiku 4.5 | 17/24 | $0.14 |
| Sonnet 5.5 low, medium, high | 21, 20, 22 of 24 | $0.12 to $0.13 |
| Opus 5.5 low, medium, high | 20, 22, 22 of 24 | $0.20 to $0.22 |
| Opus 5.5 xhigh | 24/24 | $0.28 |

- Most `t1-false-alarm` failures were right replies that showed the results but not the command.
  Without that case, every Sonnet and Opus arm passed 20 or 21 of 21.
- Haiku 4.5 failed on judgment cases and cost more per pass than Sonnet 5.5 low.
  This supports Haiku only for `test-runner`.
- Opus 5.5 medium passed as many trials as high for less.
  This supports medium as the default.
- 3 trials give wide intervals.
  The arms from Sonnet 5.5 low to Opus 5.5 xhigh do not differ significantly.

## Longer Opus and Sonnet run for 0.17.1

**Measured:** the 11 cases, with the 3 role cases, 10 trials per arm, dotclaude only, Claude Code 2.1.287, and a Sonnet 5.5 judge.
The summary is `evals/results/0.17.1-long/summary.md`.

| Arm | Passed | Without `t1-false-alarm` | Cost per pass |
| --- | --- | --- | --- |
| Sonnet 5.5 medium | 98/110 | 98/100 | $0.12 |
| Sonnet 5.5 high | 99/110 | 99/100 | $0.13 |
| Opus 5.5 medium | 101/110 | 100/100 | $0.22 |
| Opus 5.5 high | 99/110 | 98/100 | $0.24 |

- Every arm passed the 3 role cases in 10 of 10 trials.
  The role cases do not separate the models.
- In `t1-false-alarm`, the correctness judge passed 40 of 40.
  The format judge failed 38 of 40, because the replies did not show the command.
- Sonnet 5.5 is at the ceiling on these tasks at 55% to 60% of the Opus 5.5 cost.
  Opus 5.5 medium passed as many trials as high for less.
- The first `t5-debug` oracle failed 3 right fixes that added a test.
  The oracle now fails only when a line of `client.test.mjs` is removed or changed.
- The run found a stop-hook bug.
  `node --test` was not a check, so 64 of 200 code replies answered a false "no check ran" note.
  0.17.1 fixes it.
  The extra turns make the costs a little high in every arm.

## Re-run and model swap for 0.17.1

**Measured:** the same 11 cases and arms after the fixes above.
The summary is `evals/results/0.17.1-rerun/summary.md`.

| Arm | Passed | Cost per pass |
| --- | --- | --- |
| Sonnet 5.5 medium | 109/110 | $0.10 |
| Sonnet 5.5 high | 107/110 | $0.12 |
| Opus 5.5 medium | 110/110 | $0.19 |
| Opus 5.5 high | 109/110 | $0.21 |

The maintainer set this rule before the results.
An Opus agent moves to Sonnet when two conditions hold.
Sonnet passes its role case within 1 in 10 trials of Opus.
Sonnet costs 60% of the Opus cost per pass or less.

| Case | Sonnet 5.5 high against Opus 5.5 high |
| --- | --- |
| `t5-review` | 10 of 10, at 52% of the cost |
| `t5-debug` and `t3-wrong-cause` | 20 of 20 against 19 of 20, at 54% (the first run gave 53% to 56%) |

- Thus `reviewer` and `debugger` used Sonnet 5.5 at `high` from 0.17.1.
  0.20.0 lowered both to `medium`, on the numbers above.
- `investigator`, `web-researcher`, and `reverse-engineer` had no role case, so they kept Opus 5.5 then.
  0.19.0 moved `investigator` and `web-researcher` to Sonnet 5.5.
  Only `reverse-engineer` still uses Opus 5.5.
- 3 Sonnet replies to `t1-fix` ended with an offer.
  The output style now forbids an offer at the end.
  In 10 trials each after the change, Sonnet 5.5 medium and high passed `t1-fix` 10 of 10.
- One Opus report was replaced by a short reply to a Stop hook note, because `claude -p` returns only the last message.
  The note now asks for the full report in the last message.
  A unit test covers this.
  The eval trace does not record Stop hook output, so the runs do not show it.
- The role cases are at the ceiling for both models.
  The swap is not tested on hard reviews or hard root causes.
  A reported private batch of hard tasks found Sonnet 5.5 high lower than Opus 5.5 medium (see [Plans and models](Plans-and-Models)).

## Agent role cases: `investigator` and `web-researcher`

**Not measured yet:** the cases exist, and no run has used them.
Both agents moved from Opus 5.5 to Sonnet 5.5 at `medium` after 0.19.0, without a role case.
The cases let the same rule check the move.

| Case | Question | Wrong answer that the fixture offers | Checks |
| --- | --- | --- | --- |
| `t5-investigate` | Which export timeout applies in production, which file sets it, and which commit added it | 30000 from `config/default.json`, or 60000 from `config/production.json` | the reply names 5000, `prod.env`, and the commit, a judge checks the override, and the oracle checks that no commit, file, or untracked file changed |
| `t5-web-research` | The default of `server.timeout` in the Node.js `http` docs | 120 seconds, the value before v13.0.0 | the reply cites `nodejs.org/api/http.html`, quotes the page, and gives 0, and the oracle checks that nothing changed |

- Each case asks the main conversation to use the agent.
  The `used-*` grader checks the `Agent` call, and `with-only` leaves it out of a baseline arm.
- The reply graders are regexes on the `result` event of the trace.
  A match in a tool result does not count.
- `t5-web-research` depends on live pages.
  The quote grader matches the sentence "The default timeout changed from 120s to 0 (no timeout)" or "Default: 0 (no timeout)".
  Check the page before a run.
  The Node.js page was read on 2026-10-04 and has both sentences.

`just eval-agent <model> <effort> [runs]` runs both cases.
The main conversation stays on Opus 5.5 (`--model opus`).
`CLAUDE_CODE_SUBAGENT_MODEL` sets the model of the agent, and `CLAUDE_CODE_EFFORT_LEVEL` sets the effort, as in the 0.17.1 sweep.
The recipe then runs `plugins/dotclaude/evals/oracle.mjs` and `plugins/dotclaude/evals/report.mjs`.

| Arm | Command | Old setting of |
| --- | --- | --- |
| Opus 5.5 low | `just eval-agent opus low` | `web-researcher` |
| Opus 5.5 medium | `just eval-agent opus medium` | `investigator` |
| Sonnet 5.5 medium | `just eval-agent sonnet medium` | the new setting of both |
| Sonnet 5.5 low | `just eval-agent sonnet low` | a cheaper test |

- Use 10 trials per arm, as in the 0.17.1 run that set the rule.
  The cases are new, so run 1 trial first.
  The `modelUsage` of its trace must list the model of the arm.
- The effort variable also sets the effort of the main conversation.
  Thus the cost per pass of an arm includes an Opus main at that effort.
  Use the per-model cost in `modelUsage` to compare the agents alone.
- The estimate comes from `0.17.1-rerun`, where `t4-delegate` cost $0.23 per trial.
  Thus about $0.25 to $0.40 per trial, and about $20 to $32 for 4 arms, 2 cases, and 10 trials.

## Planned: compatibility rule

A state-based eval for the working rule that keeps an old name only for a named consumer.
The task is a rename in a fixture project at a version before 1.0.
The oracle is the `git diff`.
It must show no alias and no re-export of the old name.
The case is not written yet.

## Related pages

- [Evals](Evals)
- [Open items](Open-Items)
- [Plans and models](Plans-and-Models)
