# dotclaude Dossier: Design

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

> **0.20.0 status.** Sections 1 and 2 describe the 0.19 design. 0.20.0 removed the turn-limit handoff, the agent loop, the routing rule, and the usage-bound hooks that these sections name. The principles and the rejected alternatives still hold.

## 1. Design Principles

- **Mechanisms over prose.** A bound that Claude Code enforces holds. A bound
  stated only in prose did not hold in the measured week
  ([section 3](usage.md)). Prose stays only where no mechanism exists.
- **Sized for Pro.** One set of usage bounds applies on every plan. Larger
  plans reach their limits later. Fable access is the only plan-specific rule,
  because it is a fact about the plan ([section 4](plans-and-models.md)).
- **One owner for each number.** `hooks/lib/_budget.mjs` holds the bounds.
  The session note reads it directly. A test fails when the output style, the
  settings profile, or the option text disagrees with it.
- **No banned-phrase lists.** Claude routes around them with synonyms. The
  rules name what each behavior does and why.
- **No hooks that judge tone or architecture.** A regex cannot tell a needed
  abstraction from a speculative one. The system prompt and the reviewer
  agents cover those.
- **No checks on the words of a reply.** A reply can be in any language, so
  a regex on its phrases blocks correct replies and misses wrong ones. 0.18.1
  deleted the announced-work Stop hook, the reply-text tests of the verify
  gate, and the reply graders of the evals. The gates read state, such as
  the edit ledger.
  The same applies to the user's prompt.
  0.19.0 deleted the regex that found "remove the tests" in the last prompt and then dropped the assertion ask.
  The ask now stays, and the user approves it once.
- **Failure reports are evidence, not a spec.** A rule, test, or grader
  built from a report's list of failures primes the failures it names and
  rewards the wording, not the result. 0.18.1 removed the rules, graders, and
  prose tests of that shape, and cut the working rules from 8.4 KB to 5.1 KB.
- **No prompt-type or agent-type hooks.** They spend usage on every event.
- **Only documented extension points.** dotclaude uses hooks, output styles,
  skills, agents, `userConfig`, and settings keys. It never patches Claude
  Code.
- **Fail open.** A bug in a guard must not stop the user's work. The guards
  are a best-effort parser, not a sandbox.
- **One process per event.** `hooks.json` starts `hooks/dispatch.mjs` once
  for each event. The dispatcher runs the actions whose matcher fits, all at
  the same time, and merges their output in table order. **measured**
  (2026-09-29, 50 `Bash` calls): 7 hook processes per call became 2, and CPU
  time fell from about 164 ms to 86 ms per call. Wall time per event stayed
  the same (Pre about 25 ms, Post about 50 ms), because the slowest action
  sets it: `betterleaks` in PostToolUse and the load of the Bash guard's rule
  modules in PreToolUse. A bare `bun` start takes 5 ms.
- **Layered imports.** Event hooks import only `hooks/lib`. `hooks/lib`
  imports only itself (`tests/lib/layers.test.mjs`). Skill scripts may import
  `hooks/lib`.

## 2. Enforced Bounds

| # | Scenario | Bound | Mechanism | Check |
| --- | --- | --- | --- | --- |
| Q1 | A subagent works a long task | No tool call past 100k tokens of context, or 150k for the reviewers. A fork gets its first call plus 50k. The report tool stays open. | `PreToolUse` hook on every tool | `tests/hooks/agent-budget.test.mjs` |
| Q2 | The main conversation grows | Compaction at 150k | `autoCompactWindow` in the profile | `tests/lib/budget.test.mjs` |
| Q3 | Claude spawns `general-purpose` | Refused, with the dotclaude agent for the job | `PreToolUse(Agent)` hook | `tests/hooks/model-lock.test.mjs` |
| Q4 | Fan-out | 5 subagents, and 5 agents per workflow, at once | profile env | `tests/lib/budget.test.mjs` |
| Q5 | dotclaude's text on every request | token limits in `LIMITS` | footprint test | `tests/lib/budget.test.mjs` |
| Q6 | A bound changes | One edit in `_budget.mjs` | pinned copies | `tests/lib/budget.test.mjs` |
| Q7 | Claude spawns any other subagent | It runs in the foreground and causes no wake turns | `Agent` hook, `CLAUDE_CODE_FORK_SUBAGENT=0` | `tests/hooks/model-lock.test.mjs` |
| Q8 | Weekly review | The usage shares in [section 3](usage.md) are reproducible | `scripts/usage-report.mjs` | `tests/scripts/usage-report.test.mjs` |

Q2, Q4, and Q7 need the settings profile. Q1 and Q3 need only the plugin.

Fork mode forces every subagent into the background. A foreground agent
returns its report in the turn that spawned it, so it causes no wake turn.
Agents spawned in one message still run together. The expected saving is the
redundant notification turns, up to about $135 a week, or 7% (inference).
Claude Code 2.1.285 removed a second, redundant reply that came after each
background report in auto mode. The first wake turn remains, so forks stay
off.
The main session waits while agents run. Esc interrupts it.

### Turn-Limit Handoff

Claude Code delivers nothing from an agent that it stops at its turn limit.

- **measured:** Of 13 capped runs after agents were told their limit up
  front, none reported before the cap. All were still calling tools.
- A hook now refuses every tool except the report tool once about 5% of the
  limit remains, with a minimum of 3 turns.
- Claude Code counts the limit per invocation. A resume or a wake-up starts
  the count again. **measured:** resumed runs reached 100–380 calls under a
  cap of 80.
- Context grows with every turn, so the cache-read cost of a task grows with
  the square of its length. A resume keeps that growth. A fresh agent that
  starts from a report starts small.
- **inference:** Splitting a 115-turn task in two cuts its cache reads by
  about 25–30%.
- `reviewer` has a 60-turn limit. A capped review loses its findings. A
  capped `implementer` only splits its work.
- The `implementer` limit stays 80. **measured:** in the week to
  2026-09-29, 31 of 252 runs reached it, and 27 of those were past 90k
  context. Most capped briefs named one behavior. Long runs passed 100k
  context near turn 20, so the context bound now ends them first. A higher
  limit gives no more finished work.

### The Agent Loop

The `slices` skill takes the workflow of the Bun, GitHub Copilot,
and pnpm v12 Rust ports (**reported**). Each port used four parts:

- A guide, written first. `.dotclaude/loop/GUIDE.md` holds the goal, the
  invariants, and the idiom map.
- Slices that start at the leaves. Each slice has one behavior and at most 5
  files.
- A frozen test oracle. `loop.json` lists it as `protected` globs, and the
  edit and Bash guards deny a subagent's change to a match.
- A reviewer that sees only the diff. `reviewer` with the `diff` lens gets the git range and
  the guide, not the implementer's report. The Stop hook blocks once for a
  slice with the status `implemented`.

The mechanisms are hooks because an oracle that the implementer can edit
does not show anything. The main conversation is not limited, so the user
can still fix a wrong oracle.

A hypothesis was wrong. It said that worktree agents ran commands outside
their worktree. **measured:** the 50 errors were Claude Code's own refusals
of commands that it cannot verify stay in the worktree. The skill's brief
tells each agent to run plain commands from the worktree root. dotclaude adds
no guard for this, because the refusal already stops the command.

### The Routing Rule

0.19.0 replaced the subagent rule "Work in the main conversation, and use a subagent only for …" with a routing rule.
The routing rule tells Claude to delegate work whose tool results it does not need later, and to match the work to the agent descriptions.
The old rule came from one week in which subagents were over half the cost.
The causes were fan-out and `general-purpose` agents, which hooks now limit (Q1 to Q7 above).
But each main Opus turn reads the whole main context again ([99.9% cache reads](usage.md)), and users report that the main agent does almost all the work itself.
**measured** before the change (2026-10-03, 7 days): 3.8 subagent runs per 100 main turns, and a median of 19169 tool-result tokens per main session ([baseline](usage.md)).
**open:** whether the rule changes this share is in [Open Items](open-items.md).

### Rejected Alternatives

- **A 1-hour subagent cache TTL.** Subagent cache writes in the measured week
  were about 71M tokens: $355 at the 5-minute price, about $568 at the 1-hour
  price. The most the 1-hour TTL could save was $46 of rewrites after idle
  periods. The net result is about $170 a week worse.
- **More or better prose.** The 400k handoff rule and "pick the most specific
  agent" were both in the output style during the measured week.
- **Haiku for more subagents.** The cost is context times turns. No source
  that claims a saving gives measurements. Weaker models tend to take more
  turns.
- **Fixing cache invalidation first.** Full cache rewrites were 6% of cost.
  Most open issues about them (#96101, #96163, #97262, #97342, #97335) are in
  Claude Code, where a plugin cannot fix them.
- **Trimming the user's skill listing.** The user skills total 1.4 KB of
  descriptions. dotclaude cuts only its own skill and agent descriptions, to
  about 150 characters each.
- **A per-session subagent count cap.** Concurrency and the context budget
  already bound the cost. A hard count stops legitimate long sessions.
- **Headroom.** Removed in 0.10.0. It compresses tool output with loss. In
  this repository it dropped words from files that Claude then read as
  exact. The saving is on tool results only, which are a small part of a
  cached context, and every agent needed its retrieve tool.
- **Codex delegation.** Removed in 0.7.0. It was a second model catalog,
  quota reader, and profile writer. It also added Claude turns for the relay
  agents and for review of every GPT diff. **inference:** one morning of the
  maintainer's own Codex sessions, scaled from Pro 20x, would use 60–100% of
  a ChatGPT Plus week.
