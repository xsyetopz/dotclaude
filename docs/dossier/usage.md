# dotclaude Dossier: Usage Evidence

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

> **0.20.0 status.** These measurements are the evidence for 0.20.0. The delegation share and the hooks that they led to, such as the delegation note, are 0.19 history.

## 3. Usage Evidence

### The Measured Week

One Max 20x week (2026-09-21 to 09-28) reached 100% of the weekly limit. A
scan of the local transcripts (**measured**) shows where it went. The
transcripts start on 09-25, so the figures are a lower bound. Most of the
week ran before 0.5.0 moved `implementer` to Sonnet 5.

| Measure | Value |
| --- | --- |
| Total | $1,854 (Opus 5.5 98.7%) |
| Cost parts | cache reads 64.7%, cache writes 28.1%, output 7.2% |
| Main conversation | 44.9%, context p50 369k, p90 807k tokens |
| `implementer` | 30.7%, 155 runs, median 68 calls |
| `general-purpose` | 17.6%, 87 runs, median 51 calls |
| Calls with context over 150k | 74.7% of cost |
| Subagent cache writes (5-minute TTL) | 71M tokens, about $355 |
| First cache write of a fresh subagent | p50 13.9k, p90 24.8k tokens |
| Main turns that background agents started | 501 of 861, about $385 |

Three things drive the limit. Model choice is not one of them.

1. **Context per turn.** Each turn re-reads the whole context. Independent
   reports agree: issue #24147 measured 99.9% cache reads, and a cold-start
   post measured 94%.
1. **Subagent fan-out.** Each fresh subagent writes about 14k tokens to the
   cache before its first tool call. Its 5-minute cache then expires while it
   waits on long builds.
1. **`general-purpose` in place of dotclaude agents.** The output style
   preferred dotclaude agents in prose. That preference did not hold.

`bun scripts/usage-report.mjs --days 7` repeats this scan on any machine.
It also counts the sessions by entrypoint, the usage-limit hits, the skill
calls, and the guard verdicts per rule.
The report also shows the delegation share: subagent runs per 100 main turns, by agent type, and the median and p90 of tool-result tokens per main session.
`--runs N` sets how many of the latest subagent runs the table lists, with the cost and the first line of the hand-back.

**measured** (2026-10-03, 7 days): 976 subagent runs in 25578 main turns, which is 3.8 per 100 turns.
Tool-result tokens per main session: median 19169, p90 167675 (253 sessions).
This is the baseline for the 0.19.0 routing rule in [Design](design.md#the-routing-rule).

### What This Means On Pro

This section is **inference**. Anthropic publishes no weekly figure.

- A Pro week holds at least about $90–185 of Opus 5.5 usage. At the measured
  habits, the low end buys about 750 main-conversation turns or about 25
  subagent runs.
- A 150k context costs about $0.03 a turn in cache reads, against $0.074 at
  the measured median. The context cap therefore gives two to three times the
  turns.
- Every subagent that Claude does not spawn saves its first cache write and
  its whole run.

### Turns, Not Tool Calls

Usage counts tokens. Each model turn re-reads the context, so the number of
turns sets the cost.

- Independent tool calls in one response take one turn. The same calls in
  sequence take one turn each.
- One Bash call can do several reads, for example
  `sed -n 1,40p a.mjs; rg -n foo src/`.
- Claude Code has no general tool that runs several tools in one call
  (**binary**). Parallel calls in one response are the batch.
