# dotclaude Dossier: Design

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

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
- **No prompt-type or agent-type hooks.** They spend usage on every event.
- **Only documented extension points.** dotclaude uses hooks, output styles,
  skills, agents, `userConfig`, and settings keys. It never patches Claude
  Code.
- **Fail open.** A bug in a guard must not stop the user's work. The guards
  are a best-effort parser, not a sandbox.
- **Layered imports.** Event hooks import only `hooks/lib`. `hooks/lib`
  imports only itself (`tests/lib/layers.test.mjs`). Skill scripts may import
  `hooks/lib`.

## 2. Enforced Bounds

| # | Scenario | Bound | Mechanism | Check |
| --- | --- | --- | --- | --- |
| Q1 | A subagent works a long task | No tool call past 100k tokens of context, or 150k for the reviewers. A fork gets its first call plus 50k. The report tool stays open. | `PreToolUse` hook on every tool | `tests/hooks/agent-budget.test.mjs` |
| Q2 | The main conversation grows | Compaction at 150k | `autoCompactWindow` in the profile | `tests/lib/budget.test.mjs` |
| Q3 | Claude spawns `general-purpose` | Refused, with the dotclaude agent for the job | `PreToolUse(Agent)` hook | `tests/hooks/model-lock.test.mjs` |
| Q4 | Fan-out | 3 subagents, and 3 agents per workflow, at once | profile env | `tests/lib/budget.test.mjs` |
| Q5 | dotclaude's text on every request | token limits in `LIMITS` | footprint test | `tests/lib/budget.test.mjs` |
| Q6 | A bound changes | One edit in `_budget.mjs` | pinned copies | `tests/lib/budget.test.mjs` |
| Q7 | Claude spawns any other subagent | It runs in the foreground and causes no wake turns | `Agent` hook, `CLAUDE_CODE_FORK_SUBAGENT=0` | `tests/hooks/model-lock.test.mjs` |
| Q8 | Weekly review | The usage shares in [section 3](usage.md) are reproducible | `scripts/usage-report.mjs` | `tests/scripts/usage-report.test.mjs` |

Q2, Q4, and Q7 need the settings profile. Q1 and Q3 need only the plugin.

Fork mode forces every subagent into the background. A foreground agent
returns its report in the turn that spawned it, so it causes no wake turn.
Agents spawned in one message still run together. The expected saving is the
redundant notification turns, up to about $135 a week, or 7% (inference).
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
- `code-reviewer` has a 60-turn limit. A capped review loses its findings. A
  capped `implementer` only splits its work.
- The `implementer` limit stays 80. **measured:** in the week to
  2026-09-29, 31 of 252 runs reached it, and 27 of those were past 90k
  context. Most capped briefs named one behavior. Long runs passed 100k
  context near turn 20, so the context bound now ends them first. A higher
  limit gives no more finished work.

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
- **Trimming the skill listing.** The user skills total 1.4 KB of
  descriptions.
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
