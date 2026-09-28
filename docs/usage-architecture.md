# Usage architecture: fewer turns, enforced bounds, sized for Pro

Status: accepted for 0.7.0 (2026-09-28). The measurements behind it are in
`docs/pro-first-usage.md`. `bun scripts/usage-report.mjs --days 7` repeats
them on any machine.

## Context

One Max 20x week (2026-09-21 to 09-28) on this machine, API-equivalent:

| Measure | Value |
| --- | --- |
| Total | $1,869 |
| Main conversation | 45.2% (median context 369k, p90 807k) |
| `dotclaude:implementer` | 30.5% (median 68 calls per run, peak context median 193k) |
| `general-purpose` | 17.5% (83 explicit spawns, mostly implementation slices) |
| Calls with context past 150k | 74.6% of cost |
| Implementer / general-purpose cost from calls past 100k | 83% / 85% |
| Full cache rewrites (idle past TTL, mid-session, cold start) | 6% |
| Main turns started by background agents | 501 of 861 main turns, 20.6% ($385: hand-backs $250, task notifications $135) |
| dotclaude's fixed text per request | output style 15.1 KB; descriptions 8.2 KB; 3.3 KB per subagent |

The cost is re-reading large contexts. Every independent source agrees: the
reporter of issue #24147 measured 99.9% cache reads, and the Lawrentz
cold-start post measured 94% reads. Cache bugs and dotclaude's own prompt
text are small next to it. The earlier design stated its bounds as prose:
"hand off past 400k", "pick the most specific agent". The measured p90
context of 807k and the 17.5% `general-purpose` share show that the prose
did not hold.

## Quality scenarios

| # | Scenario | Measure | Check |
| --- | --- | --- | --- |
| Q1 | A subagent works a long task | No tool call runs once its context is past 150k (a fork: past its first call + 50k); the next action is the report | `tests/hooks/agent-budget.test.mjs` |
| Q2 | The main conversation grows | Claude Code compacts at 200k; the session note and output style say 200k | `autoCompactWindow` in the profile; `tests/lib/budget.test.mjs` |
| Q3 | Claude spawns `general-purpose` | Refused, with the dotclaude agent for the job | `tests/hooks/model-lock.test.mjs` |
| Q4 | Fan-out | At most 3 subagents, and 3 agents per workflow, at once | Profile env; `tests/lib/budget.test.mjs` |
| Q5 | dotclaude's text on every request | Output style + agent and skill descriptions ≤ 21.5 KB | `tests/lib/budget.test.mjs` |
| Q6 | A bound changes | One edit in `hooks/lib/_budget.mjs`; every copy that disagrees fails a test | `tests/lib/budget.test.mjs` |
| Q7 | Claude spawns any other subagent | It runs in the foreground: no wake turns | `tests/hooks/model-lock.test.mjs`; the wake-turn line of the usage report |
| Q8 | Weekly review | The usage shares above can be reproduced from local transcripts | `scripts/usage-report.mjs`, `tests/scripts/usage-report.test.mjs` |

Q2, Q4, and Q7 need the settings profile re-applied; Q1 and Q3 need only the
plugin update. How much Q1, Q3, and Q7 save will not be known until a week has
run with them. Rerun the report and compare it with the table above.

## Decision

The goal is the most finished work per turn and per token. The bounds move
out of prose and into mechanisms Claude Code enforces. Prose stays only where
no mechanism exists.

- One owner for the numbers: `hooks/lib/_budget.mjs`. The session note uses
  it directly, and a test pins the output style, the profile, the option
  text, and `codex-fanout` to it.
- Subagent context: a `PreToolUse` hook on every tool reads the agent's own
  transcript and refuses tool calls past the budget. The report tool stays
  open. The same hook still enforces the turn limit of dotclaude agents.
- Main context: the profile's `autoCompactWindow`, not a request in prose.
- Agent choice: a `PreToolUse(Agent)` deny for `general-purpose`.
- Wake turns: the same `Agent` hook sets `run_in_background: false`, and
  the profile sets `CLAUDE_CODE_FORK_SUBAGENT=false`, because fork mode forces
  every subagent into the background. A foreground agent returns its report
  as the tool result of the turn that spawned it, so it causes no wake-ups,
  and agents spawned in one message still run together. The calls that act
  on a report happen either way, so the expected saving is the redundant
  notification turns plus batching: up to about $135 a week, 7%. The
  trade-off is that the main session waits while agents run (Esc
  interrupts).
- One model source: Codex support is removed. It was a second catalog,
  quota reader, and profile writer to maintain. Delegating to it also added
  Claude turns, for the Haiku forwarders and for reviewing GPT-6 diffs.
- Fan-out: `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` and
  `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`.
- Injection: dotclaude injects no per-prompt search results (the CodeGraph
  hooks are gone; the global `CLAUDE.md` section covers CodeGraph).
- Skills: dotclaude ships only the skills its own features use. General
  workflow skills live in xsyetopz/skills, so they no longer sit in the skill
  listing on every turn of every session.
- Hooks stay. None injects context on every turn; the Stop gates, the only
  hooks that add turns, blocked 13 times in the measured week.
- Import direction: event hooks import only `hooks/lib`, and `hooks/lib`
  imports only itself (`tests/lib/layers.test.mjs`). Skill scripts may
  import `hooks/lib`.

## Rejected alternatives

- **Subagent cache TTL of 1h.** The week's subagent writes were about 71M
  tokens: $355 at the 5m price and about $568 at the 1h price. The most 1h
  could save is the $46 of subagent rewrites after idling past 5 minutes.
  That leaves it about $170 a week worse.
- **Replacing or patching the system prompt (tweakcc,
  `--system-prompt`).**
  - The fixed prefix is about 33k tokens (Systima's measurement), under a
    tenth of a median main call here.
  - `--system-prompt` is a launch flag that a plugin cannot set.
  - tweakcc has prompt data for 2.1.283, but its last release (v4.3.3,
    2026-08-13) predates 2.1.280. It repacks the native binary, and every
    update undoes the patch.
  - `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`, the documented short prompt, is
    already in the profile.
- **More or better prose.** The 400k handoff rule and "pick the most specific
  agent" were both in the active output style during the measured week.
- **Haiku for more subagents.** It is cheaper per token, but the cost is
  context times turns. The sources that claim savings (MakeUseOf, Lawrentz)
  give no measurements, and weaker models tend to take more turns. The
  budget caps the context regardless of model.
- **Fixing cache invalidation first.** That is 6% of cost, and most of the
  open issues (#96101, #96163, #97262, #97342, #97335) sit in Claude Code,
  where a plugin cannot fix them. The countdown reminder blamed in #90018
  did not break caching in this session: cache reads grew by 0.3–2k tokens
  per call.
- **Trimming the skill listing (`skillListingMaxDescChars`,
  `skillOverrides`).** The user skills here total 1.4 KB of descriptions.
- **A per-session subagent count cap.** Concurrency plus the context budget
  bound the cost. A hard count stops legitimate long sessions.

## Open decisions (the user decides)

1. **Prompts as files.** Move the long injected texts (the working
   conventions, the plan and Codex notes, the report request) into
   `hooks/prompts/*.md`, with `{{placeholders}}` filled from `_budget.mjs`.
   Short deny messages that are built from values would stay inline. This
   makes the prompts diffable and editable in one place, and lets the
   footprint test measure them.
1. **Subagent budget value.** 150k matches the `/usage` bucket. A lower cap
   saves more per run but hands off more often, and each fresh agent re-reads
   its files. Decide after one week at 150k.
1. **Idle-past-TTL notice.** A hook could suggest `/compact` or `/clear`
   when a prompt arrives after the 1h TTL has passed on a large context.
   That was about 1.5% of cost in the measured week.
