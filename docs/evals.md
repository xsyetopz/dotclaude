# Evals: Method, Results, And What They Do Not Show

dotclaude has two eval suites, both run with `claude plugin eval`, Claude Code's
own plugin eval runner. This page records how they were built, what they found
for 0.4.0, and what the next round needs. All runs used Claude Code 2.1.283,
`claude-opus-5-5` as the agent, and `claude-opus-5-5` as the judge for `llm`
graders.

## The Two Suites

| Suite | Cases | Written by | What it can show |
| --- | ---: | --- | --- |
| `evals/` | 16 | the same sessions that wrote dotclaude's prompts | that a rule dotclaude states is followed |
| `evals-heldout/` | 30 | three `claude -p --safe-mode` sessions that never saw dotclaude's prompts | whether dotclaude reduces failures users actually report |

`evals/` is circular by construction: several cases were written right after
the rule they test (reproduce a bug before fixing it, fix a confirmed bug
nobody asked about), so a pass shows the model followed the wording, not that
a real failure became rarer. Its graders were also revised after results came
in, each time for a defect a transcript confirmed, but revising the measure
after seeing scores is the pattern Goodhart's law warns about.

`evals-heldout/` exists to break that loop. Its authors worked from the failure
dossiers and exported Reddit threads only, in safe mode, which loads no
plugins, hooks, output styles, or `CLAUDE.md`. Every case cites its source, a
third of them reward acting over caution, and the suite was committed before
any agent ran against it. Its README states the only conditions under which a
case may change.

## Reading The Numbers

`bun evals/report.mjs <result.json>` follows Anthropic's guidance on eval
statistics:

- a trial passes when every scored grader passes, and each case reports trials
  passed out of trials run with a 95% Wilson interval;
- the suite mean uses standard errors clustered by case, since trials of one
  case are not independent;
- the plugin's effect is the paired per-case difference between the arm with
  the plugin and the arm without it, with its own interval.

With 5 trials, a case that passes every time still has a lower bound of 57%.
Small suites give wide intervals, and the report says so rather than hiding it
in a single score.

## Results For 0.4.0

### In-loop suite (`evals/`, 3 trials per arm)

dotclaude beat plain Opus 5.5 on the cases written for its own rules:

| Case | dotclaude | Without |
| --- | ---: | ---: |
| `question-confirmed-bug` | 3/3 | 0/3 |
| `scope-follow-up` | 2/3 | 0/3 |
| `false-alarm` | 3/3 | 1/3 |
| `wrong-diagnosis` | 3/3 | 2/3 |
| `handoff-note` (a dotclaude skill, so not compared) | 3/3 | 0/3 |

These are from the last full run of the suite; other cases scored the same in
both arms, except `finish-without-offer` (2/3 with, 3/3 without), which a stop
gate fix in 0.4.0 addressed. Paired difference over the cases both arms can
attempt: +18%, 95% CI −2% to +38%.

### Held-out suite (`evals-heldout/`, 5 trials per arm)

| | Result |
| --- | --- |
| Trials passing, with dotclaude | 95% (clustered 95% CI 90% to 100%) |
| Paired difference, dotclaude minus without | −1%, 95% CI −4% to +1% |
| Cases at 5/5 in both arms | 27 of 30 |
| Cases equally hard in both arms | `a-env-vars-bare-list` 2/5, `a-retry-statuses-direct-answer` 3/5 |
| Cases where dotclaude did worse | `b-remove-legacy-pricing` 3/5 vs 5/5 |

The one regression was a dotclaude bug: the edit guard asked before removing
test assertions even though the user's message said to delete those tests, and
a non-interactive run cannot answer an ask. 0.4.0 fixes it; the case then
passed 5/5.

## What This Shows And Does Not Show

- On 30 blind, single-turn failure shapes in small repositories, Opus 5.5
  already behaves well, and dotclaude neither helps nor hurts measurably once
  the guard bug is fixed.
- dotclaude's measured gains come from cases written alongside its rules. They
  show the rules are followed; they do not show those rules matter on real
  work.
- The held-out suite sits at its ceiling (27 of 30 cases pass every trial in
  both arms), so it works as a regression check but cannot show a benefit.
  Anthropic's guidance is that capability evals should start at a low pass
  rate.
- Neither suite covers what these tasks lack: long sessions, compaction,
  corrections spread over several turns, and larger repositories.

## Next Round

A capability suite, again written blind and frozen before any run, aimed at
what plain Opus 5.5 fails at:

- long sessions that cross a compaction, with constraints stated early;
- corrections given over several turns, using `context.history_file` to
  resume a prepared transcript;
- larger repositories, where the relevant code is not in the first files read;
- terse-answer requests, which both arms failed about half the time.

These cases run longer and cost more per trial than the current ones; the
0.4.0 held-out run (30 cases, 5 trials, both arms) cost about $54 at list
price and took 32 minutes.
