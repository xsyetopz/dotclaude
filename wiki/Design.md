# Design

This page explains why dotclaude works the way it does.
Source labels (official, binary, capture, measured, reported, inference) are in [Home](Home).

## Summary

- 0.27.0 rebuilt the core plugin from an empty tree on official extension points.
  The next section lists the facts behind that choice.
- A bound that Claude Code enforces holds.
  A bound that only prose states did not hold in the measured week.
- One set of usage bounds, sized for Pro, applies on every plan.
- `plugins/dotclaude/lib/budget.mjs` owns each number.
- Hooks read state.
  They never judge tone, architecture, or the words of a reply.
- The turn-limit handoff, the agent loop, and the routing rule are 0.19 history.
  0.20.0 removed them.
- The rejected alternatives still hold.

## The 0.27 rebuild

Source tags: **official** is a doc of Claude Code, **binary** is the 2.1.292 bundle, **reported** is a public best-practices source or user feedback, and **inventory** is a count in this repository.

- A plugin `settings.json` can keep only `agent` and `subagentStatusLine` (**official**, `plugins/components.md`).
  So the profile is a template that `/dotclaude:setup` applies.
- `force-for-plugin` in an output style overrides the `outputStyle` of the user.
  `keep-coding-instructions` defaults to false (**official**, `output-styles.md`).
- No settings key replaces the system prompt, and only CLI flags do (**official**, `cli-reference.md`).
- The prompt has a `shared` block and a `session` block.
  `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1` swaps `shared` for a lean body (**binary**).
- `DISABLE_COMPACT=1` with `CLAUDE_CODE_MAX_CONTEXT_TOKENS` sets the window, and at the limit the turn ends with `blocking_limit` (**binary**).
- Opus 5.5 is on the "billed past 200K" list of 2.1.292, so `/context` and the context warnings use a 200K window for it.
  The block point stays at the full window.
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000` moves the display and the warnings to 300K, and a sandbox `/context` then showed `19.4k / 300k` (**binary**).
  The variable takes a plain integer from 100,000 to 1,000,000, and the window of the model caps it.
  A value such as `500k` reads as 500 and is raised to the 100K minimum (**official**, `env-vars.md`).
- The stop at the limit was measured on 2.1.292 in `just sandbox` with the 300K window (**measured**):
  - A first prompt larger than the window ended with `terminal_reason: "blocking_limit"` and "Prompt is too long", with 0 tokens used.
  - In a turn that read large files, the context went from 223,461 to 245,427 to 267,792 tokens.
    The next read ended the turn with `blocking_limit`, after 4 turns, for $0.72.
  - The debug log had no compaction line, and the transcript had no compact summary.
  The 1M window has "no premium for tokens beyond 200K" (**official**, `model-config.md`).
  `DISABLE_COMPACT` also disables `/compact` (**official**, `env-vars.md`).
- Opus 5.5, Sonnet 5.5, and Fable 5.1 have 1M native windows, and Haiku 4.5 has 200K and no effort (**binary**).
- The 300K window is a judgment.
  Reports put context rot around 300K to 400K on a 1M window, and one says to keep use under 40% (**reported**, [Open items](Open-Items)).
- A top-level `effortLevel` does not count for Opus 5.5 (**official**, `model-config.md`).
  An effort change keeps the cache, and a model switch, a tool-set change, and compaction break it (**official**, `prompt-caching`).
- Each tool definition goes in each request, so the profile removes the tools that dotclaude does not use: Artifact, Workflow, ScheduleWakeup, ReportFindings, and the advisor.
  `/context` at the start of a sandbox session fell from 32k to 8.1k tokens (**measured**, [Prompt surface](Prompt-Surface#tool-removal)).
- Deny rules are not a security boundary, so the profile pairs them with the sandbox (**official**, `permissions.md`).
  A sandbox cut permission prompts by 84% in one report (**reported**).
- Users want asks only for destroy, reach-out, and secret reads (**reported**).
  A guardrail pack made no difference in an A/B, and prompt-only rules decay (**reported**).
- Hook processes per `Bash` call fell from 7 to 2 with the module in 0.19 (**inventory**).

## Design principles

| Principle | What it means |
| --- | --- |
| Mechanisms over prose | Prose stays only where no mechanism exists ([Usage evidence](Usage-Evidence#the-measured-week)). |
| Sized for Pro | Larger plans reach their limits later. 0.27.0 has no plan-specific value ([Plans and models](Plans-and-Models#plan-detection)). |
| One owner for each number | `plugins/dotclaude/lib/budget.mjs` holds the bounds. Tests pin its copies in code and config, not in prose. |
| No banned-phrase lists | Claude routes around them with synonyms. The rules name what each behavior does and why. |
| No hooks that judge tone or architecture | A regex cannot tell a needed abstraction from a speculative one. The system prompt and the reviewer agents cover those. |
| No prompt-type or agent-type hooks | They spend usage on every event. |
| Only documented extension points | dotclaude uses hooks, output styles, skills, agents, `userConfig`, and settings keys. It never patches Claude Code. |
| Fail open | A bug in a guard must not stop the work of the user. The guards are a best-effort parser, not a sandbox. |
| Layered imports | `plugins/dotclaude/lib/` imports only itself. `hooks/`, `status-line/`, and the skill scripts import only `lib/` and their own folder. |

### No checks on the words of a reply

A reply can be in any language.
A regex on its phrases blocks right replies and misses wrong ones.

- 0.18.1 removed the announced-work Stop hook, the reply-text tests of the `verify` gate, and the reply graders of the evals.
- The gates read state, such as the edit ledger.
- The same applies to the prompt of the user.
  0.19.0 removed the regex that found "remove the tests" in the last prompt and then dropped the assertion ask.
  The ask now stays, and the user approves it once.

### Failure reports are evidence, not a spec

A rule, test, or grader built from a list of failures primes the failures it names.
It rewards the wording and not the result.
0.18.1 removed the rules, graders, and prose tests of that shape.
It cut the working rules from 8.4 KB to 5.1 KB.

### One module for the tool hooks

0.27.0 loads `plugins/dotclaude/hooks/mod.mjs` as a hooks module.
The module handles one event, `tool.check`, and the core plugin has no classic hook ([Claude mods](Claude-Mods)).
The pure rules are in `lib/guard.mjs`, and the lab in `tests/mod.test.ts` runs the module with stubs.

0.22 to 0.26 had a larger module and two classic hooks.
0.19 started `hooks/dispatch.mjs` once for each event.
**measured** (2026-09-29, 0.19, 50 `Bash` calls): 7 hook processes per call became 2.
CPU time fell from about 164 ms to 86 ms per call.
A bare `bun` start takes 5 ms.

## Enforced bounds

| Scenario | Bound | Mechanism | Check |
| --- | --- | --- | --- |
| A subagent works a long task | `maxTurns` in the agent file: 20 for `test-runner`, 80 for `implementer`, 60 for the others | Claude Code ends the agent at the limit | `tests/dotclaude/` |
| A subagent model and effort | Opus 5.5 and Sonnet 5.5 `low` to `max`, Haiku 4.5 none (`SUBAGENT_EFFORTS`) | The `model` and `effort` of each agent file | `tests/dotclaude/` |
| The main conversation grows | A 300K window and no compaction | `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `DISABLE_COMPACT`, and `autoCompactEnabled:false` in the profile | `tests/dotclaude/` |
| A `rm -r` outside the project, or a repo of another owner with an AI policy | An ask | `tool.check` in `hooks/mod.mjs` | `tests/mod.test.ts` |
| Fan-out | 5 subagents, and 5 agents per workflow, at once | profile env | none |
| A subagent runs in the background | It runs in the foreground and causes no wake turns | `CLAUDE_CODE_FORK_SUBAGENT=0` in the profile | none |
| Text of dotclaude on every request | The output style at most 6,000 bytes | `STYLE_MAX_BYTES` | A test fails above the bound (see `tests/dotclaude/`) |
| Weekly review | The usage shares in [Usage evidence](Usage-Evidence) are reproducible | `tools/usage-report.mjs` | none |

The profile rows need `/dotclaude:setup`.
The `maxTurns`, effort, and ask rows need only the plugin.

### Subagent context (0.19 to 0.26 history)

0.19 to 0.26 showed the subagent context against `AUTO_COMPACT_TOKENS` (117k) on the status line, because a subagent compacted at the same point as the main conversation.
0.27.0 has no such status line row.

- **measured** (914 subagent runs, 2026-09-28 to 2026-10-05): the peak context of a run stopped at about 117k, and 1 run reached 162k.
- 78 of 457 `implementer` runs passed 100k, so the earlier 100k bound showed a warning for normal runs.
- 0.19 enforced a 100k bound (150k for the `reviewer`) with a hook, and 0.20.0 removed it.

### Fork mode

Fork mode (`CLAUDE_CODE_FORK_SUBAGENT`) forces every subagent into the background.
A foreground agent returns its report in the turn that spawned it, so it causes no wake turn.
Agents spawned in one message still run together.

- The expected saving is the redundant notification turns, up to about $135 a week, or 7% (inference).
- Claude Code 2.1.285 removed a second, redundant reply that came after each background report in auto mode.
- The first wake turn remains, so forks stay off.
- The main session waits while agents run.
  Esc interrupts it.

## Turn-limit handoff (0.19 history)

0.19 added a hook that refused every tool except the report tool near the turn limit of an agent.
0.20.0 removed it, and `maxTurns` alone bounds an agent.
The measurements stay as the reason to keep tasks short.

<details>
<summary>Measurements and reasons</summary>

Claude Code delivers nothing from an agent that it stops at its turn limit.

- **measured:** Of 13 capped runs after agents learned their limit up front, none reported before the cap.
  All were still calling tools.
- The 0.19 hook refused every tool except the report tool once about 5% of the limit remained, with a minimum of 3 turns.
- Claude Code counts the limit per invocation.
  A resume or a wake-up starts the count again.
  **measured:** resumed runs reached 100 to 380 calls under a cap of 80.
- Context grows with every turn.
  The cache-read cost of a task therefore grows with the square of its length.
  A resume keeps that growth.
  A fresh agent that starts from a report starts small.
- **inference:** Splitting a 115-turn task in two cuts its cache reads by about 25 to 30%.
- `reviewer` has a 60-turn limit.
  A capped review loses its findings.
  A capped `implementer` only splits its work.
- The `implementer` limit stays 80.
  **measured:** in the week to 2026-09-29, 31 of 252 runs reached it, and 27 of those were past 90k context.
  Most capped briefs named one behavior.
  Long runs passed 100k context near turn 20, so the 0.19 context bound ended them first.
  A higher limit gives no more finished work.
  0.20.0 keeps 80 for `implementer`.

</details>

## The agent loop (0.19 history)

0.20.0 removed the `slices` skill and the guards that held its oracle, because `/goal` covers a large change.

<details>
<summary>The 0.19 loop and the worktree hypothesis</summary>

The 0.19 `slices` skill took the workflow of the Bun, GitHub Copilot, and pnpm v12 Rust ports (**reported**).
Each port used four parts:

- A guide, written first.
  `.dotclaude/loop/GUIDE.md` holds the goal, the invariants, and the idiom map.
- Slices that start at the leaves.
  Each slice has one behavior and at most 5 files.
- A frozen test oracle.
  `loop.json` lists it as `protected` globs.
  The edit and Bash guards deny a change by a subagent to a match.
- A reviewer that sees only the diff.
  `reviewer` with the `diff` lens gets the git range and the guide, not the report of the implementer.
  The Stop hook blocks once for a slice with the status `implemented`.

The 0.19 mechanisms were hooks because an oracle that the implementer can edit shows nothing.
The main conversation is not limited, so the user can still fix a wrong oracle.

One hypothesis was wrong.
It said that worktree agents ran commands outside their worktree.
**measured:** the 50 errors were refusals by Claude Code of commands that it cannot check stay in the worktree.
The brief of the 0.19 skill told each agent to run plain commands from the worktree root.
dotclaude added no guard for this, because the refusal already stops the command.

</details>

## The routing rule (0.19 history)

0.20.0 removed the routing rule and the delegation note, because users report cost blow-ups from subagents.
`tools/usage-report.mjs` still reports the delegation share.

<details>
<summary>What the rule said and the evidence</summary>

0.19.0 replaced the subagent rule "Work in the main conversation, and use a subagent only for …" with a routing rule.
The routing rule tells Claude to delegate work whose tool results it does not need later.
It also tells Claude to match the work to the agent descriptions.

- The old rule came from one week in which subagents were over half the cost.
  The causes were fan-out and `general-purpose` agents, which the profile and `maxTurns` now limit.
- Each main Opus turn reads the whole main context again (99.9% cache reads, see [Usage evidence](Usage-Evidence#the-measured-week)).
- Users report that the main agent does almost all the work itself.
- **measured** before the change (2026-10-03, 7 days): 3.8 subagent runs per 100 main turns.
  The median was 19169 tool-result tokens per main session ([baseline](Usage-Evidence#the-delegation-share)).
- The rule is gone, so no one measured whether it changed this share.

</details>

## The 5-minute main cache

The settings profile (`plugins/dotclaude/templates/settings.json`) sets `promptCacheTtl` to `"5m"`.

- **measured:** In 7 days of transcripts, 98.7% of the calls of the main agent came 5 minutes or less after the call before.
- At API prices, the 5-minute cache would have cost 8.5% less than the 1-hour cache.
- A 5-minute write costs 1.25x, and a 1-hour write costs 2x (see the subagent numbers below).
  So the 1-hour cache pays only when a pause of 5 to 60 minutes is common.

## Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| A 1-hour subagent cache TTL | About $170 a week worse. See the details below. |
| More or better prose | The 400k handoff rule and "pick the most specific agent" were both in the 0.19 output style during the measured week. |
| Haiku for more subagents | The cost is context times turns. No source that claims a saving gives measurements. Weaker models tend to take more turns. |
| Fixing cache invalidation first | Full cache rewrites were 6% of cost. Most open issues about them (#96101, #96163, #97262, #97342, #97335) are in Claude Code, where a plugin cannot fix them. |
| Trimming the skill listing of the user | The user skills total 1.4 KB of descriptions. dotclaude cuts only its own skill and agent descriptions, to about 150 characters each. |
| A per-session subagent count cap | Concurrency and the context budget already bound the cost. A hard count stops legitimate long sessions. |
| Headroom | Removed in 0.10.0. It compresses tool output with loss. In this repository it dropped words from files that Claude then read as exact. The saving is on tool results only, which are a small part of a cached context. Every agent needed its retrieval tool. |
| Codex delegation | Removed in 0.7.0. It was a second model catalog, quota reader, and profile writer. It also added Claude turns for the relay agents and for review of every GPT diff. **inference:** one morning of the Codex sessions of the maintainer, scaled from Pro 20x, would use 60 to 100% of a ChatGPT Plus week. |

<details>
<summary>The 1-hour subagent cache TTL in numbers</summary>

- Subagent cache writes in the measured week (2026-09-21 to 09-28) were about 71M tokens.
  They cost $355 at the 5-minute price and about $568 at the 1-hour price.
- The 1-hour TTL could save at most $46 of rewrites after idle periods.
  The net result is about $170 a week worse.
- **measured** again on 2026-10-05 from the request times of 981 subagent runs in 7 days.
  The figures below are from this second measurement, and not from the measured week.
  The time between two requests of one subagent includes the tool time, such as a test run.
  21,765 gaps were under 5 minutes, 41 were 5 to 60 minutes, and 1 was longer.
- The documented price ratios are 1.25x for a 5-minute write, 2x for a 1-hour write, and 0.1x for a read.
  At these ratios, the 5-minute TTL cost $796 and the 1-hour TTL cost $967, so 1 hour costs $171 more.
- The 41 long gaps, such as 10 to 30 minute test runs, saved 2.54M tokens of rewrites.
  But all 65.5M tokens of writes in these 7 days paid the higher price.
- A new agent that reads the cached prefix of an earlier agent of the same kind saves at most $5 more.
- The 1-hour TTL pays only when about each subagent run has a pause of 5 to 60 minutes.
- The 0.20.4 profile does not set `subagentPromptCacheTtl`.

</details>

## Related pages

- [Usage evidence](Usage-Evidence)
- [Plans and models](Plans-and-Models)
- [Prompt surface](Prompt-Surface)
- [Parts](Parts)
