# Usage evidence

This page shows where the usage of one heavy week went and what it means for dotclaude.
These measurements are the evidence for 0.20.0.
Source labels (official, binary, capture, measured, reported, inference, tested) are in [Home](Home).

## Summary

- One Max 20x week reached 100% of the weekly limit at $1,854 (**measured**).
- Three things drive the limit: context per turn, subagent fan-out, and `general-purpose` agents.
  Model choice is not one of them.
- The delegation share and the hooks that it led to, such as the delegation note, are 0.19 history.
- Turns set the cost, not tool calls.
- Of the community tips, one set is true, one is false, and some tools are not used.
- The CodeGraph note hook is 0.20 to 0.26 history, and 0.27.0 removed it.

## The measured week

One Max 20x week (2026-09-21 to 09-28) reached 100% of the weekly limit.
A scan of the local transcripts (**measured**) shows where it went.
The transcripts start on 09-25, so the figures are a lower bound.
Most of the week ran before 0.5.0 moved `implementer` to Sonnet 5.

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

Three things drive the limit.
Model choice is not one of them.

1. **Context per turn.**
   Each turn reads the whole context again.
   Independent reports agree: issue #24147 measured 99.9% cache reads, and a cold-start post measured 94%.
1. **Subagent fan-out.**
   Each fresh subagent writes about 14k tokens to the cache before its first tool call.
   Its 5-minute cache then expires while it waits on long builds.
1. **`general-purpose` in place of dotclaude agents.**
   The 0.19 output style preferred dotclaude agents in prose.
   That preference did not hold.
   The 0.20 to 0.26 profile denied `Agent(general-purpose)`.
   Check the 0.27 deny list in `plugins/dotclaude/templates/settings.json` before you rely on this rule.

## The delegation share

`bun tools/usage-report.mjs --days 7` repeats this scan on any machine.

| Output | Note |
| --- | --- |
| Sessions by entrypoint, usage-limit hits, skill calls | Counted by the scan. |
| Guard verdicts per rule | Read from a `verdicts.jsonl` file. No 0.20 hook writes that file, so the table shows only rows from 0.19 and earlier. |
| Delegation share | Subagent runs per 100 main turns, by agent type. |
| Tool-result tokens per main session | Median and p90. |
| Latest subagent runs | `--runs N` sets how many the table lists, with the cost and the first line of the hand-back. |

**measured** (2026-10-03, 7 days): 976 subagent runs in 25578 main turns, which is 3.8 per 100 turns.
Tool-result tokens per main session: median 19169, p90 167675 (253 sessions).
This is the baseline for the 0.19.0 routing rule ([Design](Design#the-routing-rule-019-history)).

## What this means on Pro

This section is **inference**.
Anthropic publishes no weekly figure.

- A Pro week holds at least about $90 to $185 of Opus 5.5 usage.
  At the measured habits, the low end buys about 750 main-conversation turns or about 25 subagent runs.
- A 150k context costs about $0.03 a turn in cache reads, against $0.074 at the measured median.
  The context cap therefore gives two to three times the turns.
- Every subagent that Claude does not spawn saves its first cache write and its whole run.

## Turns, not tool calls

Usage counts tokens.
Each model turn reads the context again, so the number of turns sets the cost.

- Independent tool calls in one response take one turn.
  The same calls in sequence take one turn each.
- One Bash call can do several reads, for example `sed -n 1,40p a.mjs; rg -n foo src/`.
- Claude Code has no general tool that runs several tools in one call (**binary**).
  Parallel calls in one response are the batch.

## Community claims

Users share tips to save weekly usage.
dotclaude 0.20.4 checked each tip against the Claude Code docs or a measurement on this machine.

### True

- `/compact` reads the whole conversation to write its summary.
  On a large context it is an expensive request (**official**: costs, prompt caching).
  `/clear` costs nothing.
- A handoff note and then `/clear` is the cheap way to start the next task.
- Sonnet does implementation work for less usage than Opus ([Plans and models](Plans-and-Models#model-fit)).
- `MEMORY.md` loads at every start, up to its first 200 lines or 25 KB (**official**).
  Topic files in the memory folder do not load at start.
- A short `CLAUDE.md` saves usage.
  It loads at every start and in every subagent that does not set `omitClaudeMd`.
- Subagents keep large reads out of the main context.

### False

- Old `.jsonl` transcripts in `~/.claude/projects/` do not go into the context.
  Only `/resume` loads one.
  A remove saves disk space only, and this machine had 1.9 GB of them.
  The profile sets `cleanupPeriodDays` to 14, so Claude Code removes them.

### Tools that dotclaude does not use

| Tool | Reason |
| --- | --- |
| RTK | JetBrains measured 7.6% more cost. |
| Graphify | It fails on large repositories. |
| grepai | It needs embeddings from Ollama or OpenAI, and it has no measurement. |
| Ponytail | JetBrains measured 10.3% less cost with no change in quality, but only when a SessionStart hook added its text. dotclaude 0.20 to 0.26 added its own short version of the idea at session start, with the `ponytail` option. 0.27.0 removed that option. |

## Code search (0.20 to 0.26 history)

0.27.0 has no CodeGraph hook and no search note.
The measures below are the evidence for the 0.20.4 hook that 0.27.0 removed.

**measured:** The transcripts of this machine include subagents.
Shell `rg`, `grep`, and `find` calls outnumber `codegraph` calls (CLI and MCP):

| Project | Ratio | Calls |
| --- | --- | --- |
| OpenJoystickDriver | about 14 to 1 | 7,717 to 543 |
| dotclaude | 10 to 1 | 4,176 to 406 |

The MCP server was installed for part of this time, so its instructions did not change the habit.
A rule that names a tool does not change it either.
Thus 0.20.4 adds the graph to the search result, as the GitNexus hooks do, and keeps the CodeGraph MCP server off.

- The MCP server sends its tools and instructions on every turn.
  Its `prompt-hook` adds up to about 15 KB to each prompt.
- The hook of dotclaude adds about 300 to 600 bytes, once for each symbol in each context.
  It acts only on a search for one symbol name.

<details>
<summary>Why the hook runs codegraph query first</summary>

- `codegraph callers` falls back to a text search for a name that is not a symbol.
- In the sessions of 2026-10-04 and 2026-10-05, about 34 notes came for words such as `token`, `delet`, and `REDACTED` (**measured**).
- Thus the hook now runs `codegraph query` first.
  It adds a note only when the index has a function, method, class, or a similar definition with exactly that name.
- The note names the file and line of the definition.
- CodeGraph can link a call to a different function with the same name.
  The note therefore tells Claude to read a call in the source before it relies on the link.

</details>

## Related pages

- [Design](Design)
- [Plans and models](Plans-and-Models)
- [Eval history](Evals-History)
