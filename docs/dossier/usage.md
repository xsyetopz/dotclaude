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
1. **`general-purpose` in place of dotclaude agents.** The 0.19 output style
   preferred dotclaude agents in prose. That preference did not hold.
   The profile now denies `Agent(general-purpose)`.

`bun scripts/usage-report.mjs --days 7` repeats this scan on any machine.
It also counts the sessions by entrypoint, the usage-limit hits, and the skill
calls.
It reads guard verdicts per rule from a `verdicts.jsonl` file, but no 0.20 hook writes that file, so the table is empty.
The report also shows the delegation share: subagent runs per 100 main turns, by agent type, and the median and p90 of tool-result tokens per main session.
`--runs N` sets how many of the latest subagent runs the table lists, with the cost and the first line of the hand-back.

**measured** (2026-10-03, 7 days): 976 subagent runs in 25578 main turns, which is 3.8 per 100 turns.
Tool-result tokens per main session: median 19169, p90 167675 (253 sessions).
This is the baseline for the 0.19.0 routing rule in [Design](design.md#the-routing-rule-019-history).

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

### Community Claims

Users share tips to save weekly usage.
dotclaude 0.20.4 checked each tip against the Claude Code docs or a measurement on this machine.

True:

- `/compact` reads the whole conversation to write its summary, so on a large context it is an expensive request (**official**: costs, prompt caching).
  `/clear` costs nothing.
- A handoff note and then `/clear` is the cheap way to start the next task.
- Sonnet does implementation work for less usage than Opus ([Plans and models](plans-and-models.md#model-fit)).
- `MEMORY.md` loads at every start, up to its first 200 lines or 25 KB (**official**).
  Topic files in the memory folder do not load at start.
- A short `CLAUDE.md` saves usage, because it loads at every start and in every subagent that does not set `omitClaudeMd`.
- Subagents keep large reads out of the main context.

False:

- Old `.jsonl` transcripts in `~/.claude/projects/` do not go into the context.
  Only `/resume` loads one.
  A delete saves disk space only, and this machine had 1.9 GB of them.
  The profile sets `cleanupPeriodDays` to 14, so Claude Code deletes them.

Tools that dotclaude does not use:

- RTK: JetBrains measured 7.6% more cost.
- Graphify: it fails on large repositories.
- grepai: it needs embeddings from Ollama or OpenAI, and it has no measurement.
- Ponytail: JetBrains measured 10.3% less cost with no change in quality, but only when a SessionStart hook added its text.
  dotclaude adds its own short version of the idea at session start, with the `ponytail` option.

### Code Search

**measured:** In this machine's transcripts, subagents included, shell `rg`, `grep`, and `find` calls outnumber `codegraph` calls (CLI and MCP) by about 14 to 1 in OpenJoystickDriver (7,717 to 543) and 10 to 1 in dotclaude (4,176 to 406).
The MCP server was installed for part of this time, so its instructions did not change the habit.
A rule that names a tool does not change it either.
Thus 0.20.4 adds the graph to the search result, as the GitNexus hooks do, and keeps the CodeGraph MCP server off.
The MCP server sends its tools and instructions on every turn, and its `prompt-hook` adds up to about 15 KB to each prompt.
The hook adds about 300 to 600 bytes, once for each symbol in each context, and only to a search for one symbol name.
CodeGraph can link a call to a different function with the same name, so the note tells Claude to read a call in the source before it relies on the link.
