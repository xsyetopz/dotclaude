# Plans and models

This page records the plan, price, model, and effort facts that shape the choices of dotclaude.
Source labels (official, binary, capture, measured, reported, inference) are in [Home](Home).

## Summary

- The current model and effort rules are in [Parts](Parts#model-and-effort-rules).
- 0.20.0 removed Fable from `availableModels`, plan detection as a policy, and the model lock.
  This page keeps the 0.19 policy as history.
- 0.27.0 has no plan detection.
  `lib/plan.mjs` and the `plans` object of the profile are gone, and the usage bounds in `lib/budget.mjs` are the same on every plan.
- Opus 5.5 is the default model in the profile.
  0.27.0 has no advisor, and setup removes the 0.26 `advisorModel`.
  Sonnet 5.5 is the model of four subagents and of `CLAUDE_CODE_SUBAGENT_MODEL`.
  Haiku 4.5 runs `test-runner`.
- `maxEffortLevel` is `xhigh`, and the profile sets no `effortLevel`.
  Subagent effort levels come from `SUBAGENT_EFFORTS` in `plugins/dotclaude/lib/budget.mjs`.

## Plan detection

0.27.0 does not detect the plan.
Plan detection was a 0.20 to 0.26 part (`lib/plan.mjs`).
It read `oauthAccount` in `~/.claude.json`, and it set the cache time and a SessionStart note on `api`.
0.27.0 removed it, and the code no longer holds a per-plan value.
No evidence supports a plan-specific value.
A new override needs a cited difference on this page first.

0.19 chose the policy in the next section with the option `model_plan: auto`, which 0.20.0 removed.
The fields below are from the 0.19 evidence.

| Field | Values seen |
| --- | --- |
| `organizationType` | `claude_max` (others unverified) |
| `organizationRateLimitTier`, `userRateLimitTier` | `default_claude_max_5x`, `default_claude_max_20x`, `default_claude_zero` |
| `billingType`, `hasExtraUsageEnabled` | `stripe_subscription`, `false` |

- A Bedrock, Vertex, or Foundry provider resolves to `api`.
- Usage-based billing resolves to `api`.
- An API key without an OAuth account resolves to `api`.
- The limit buckets are `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, and `seven_day_overage_included` (**binary**).
  The status line receives only the first two.

## Per-plan policy (0.19 history)

The model lock, the profile, and the session note of 0.19 applied this policy.
0.20.0 removed all three uses.
Fable is never a subagent model.

| Plan | Fable | Session note |
| --- | --- | --- |
| `max_20x`, `max_5x`, `team_premium` | main conversation only | 50% weekly cap, use it for planning or advice |
| `pro`, `team_standard` | left out unless extra usage is on | paid credits, small 5-hour window |
| `api` | allowed | per-token price ratios |
| `enterprise`, unknown | allowed | no Fable note |

dotclaude does not use `opusplan` on any plan (decision of the user, 0.20.4).
`opusplan` switches the model when plan mode starts and ends.
**official:** a model switch loses the prompt cache.
The next turn then writes the whole context again at full price (code.claude.com/docs/en/prompt-caching, "Switching models").
A model change belongs right after `/clear`, when the context is small.

## The Fable limit

Fable is a cap inside the regular weekly limit, not an extra pool.

| Source | Fact |
| --- | --- |
| **official** | On Max and on Team or Enterprise premium seats: "You can use up to 50% of your weekly usage limits on Fable models at no extra cost." Fable draws from the regular limit and uses it faster than other models. |
| **official** | On Pro and on standard Team or Enterprise seats, Fable runs on usage credits from the first message. |
| **official** | Usage-based Enterprise and the API pay standard API rates. |
| **binary** | The bundle labels the `seven_day_overage_included` limit "Fable limit". `/usage` shows it as "Current week (Fable)". |
| **reported, not official** | Fable also drains the 5-hour window quickly. The binary applies session and weekly limits to every model. |

"Fable weekly 0% used" next to "Weekly 82% used" does not mean that Fable has free headroom.
Every model has at most the remaining 18%, and Fable spends it faster.

## Prices

API list prices per million tokens (**official**):

| Model | Input | Output | Cache read | 5-minute cache write |
| --- | --- | --- | --- | --- |
| Fable 5.1 | $10 | $50 | $0.25 | $12.50 |
| Opus 5.5 | $4 | $20 | $0.20 | $5 |
| Sonnet 5.5 | $2 | $10 | $0.20 | $2.50 |
| Haiku 4.5 | $1 | $5 | $0.10 | $1.25 |

- Anthropic publishes no subscription multipliers.
- Sonnet 5.5 has the same prices as Sonnet 5 (**official**).
- Cache reads cost the same on Opus 5.5 and Sonnet 5.5.
  They were about 65% of the measured spend.
  A move to Sonnet 5.5 therefore halves only the writes and the output.
  **inference:** that is about a fifth to a third of subagent cost.

## Cache facts

| Source | Fact |
| --- | --- |
| **official** | A 1-hour cache write costs 2x the input price. Cache reads cost 0.1x, but 0.05x on Opus 5.5 and 0.025x on Fable 5.1. |
| **official** | In Claude Code, the cache of the main conversation lives 1 hour on a subscription within its limits. It lives 5 minutes on usage credits or an API key. Subagents use 5 minutes. |
| **official** | `/model` loses the whole cache. An effort change and the advisor toggle keep it. `/rewind` and forks read the existing cache. |
| **binary** | From Claude Code 2.1.287, the SessionStart input for `resume` and `fork` has `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, and `estimated_cache_write_usd`. dotclaude 0.20 to 0.26 used them on `resume`, and 0.27.0 does not. |
| **reported** | One user found that turns more than 1 hour after the last turn were 1.6% of turns and 80% of cache writes. |
| **measured** | A one-word Fable reply from a fresh `claude -p` context cost $0.47. Every fresh Fable context, such as a subagent, pays this fixed cost. |

A prompt after the TTL, and a `/compact` after it, write the whole context again.
0.20 to 0.26 told Claude, and so the user, about an expired cache.
0.27.0 has no cache note.
It turns compaction off, and `promptCacheTtl` is `5m` in the profile.

### Advisor cost

- **measured:** An advisor call reads the whole conversation without the cache.
  In one week of the transcripts of this machine, 41 advisor calls read 215k tokens each on average, with no cache reads.
  That was 2.1% of the API-equivalent cost on Opus 5.5.
- The call's own `usage` leaves the advisor out, and `usage.iterations` holds it as an `advisor_message`.
- **reported:** A user quotes the advisor docs of Anthropic.
  A Fable 5.1 advisor over Opus 5.5 at high effort scored 1.7 points more for about 2.1 times the cost.
  Opus 5.5 at xhigh alone scored 91.1%.
  Low effort with an advisor scored 7 points less.
- 0.27.0 removes `advisorModel` (decision of the user).

## Model fit

This section weighs **reported** experience and the guidance of Anthropic.

| Model | Use for | Avoid for |
| --- | --- | --- |
| Opus 5.5 | The default, at `medium` effort, and at `high` for hard work. Users report that it matches or beats Fable 5.1 on coding at a much lower cost. | Nothing named. |
| Fable 5.1 | A planner or advisor in the main conversation, when Opus 5.5 has not solved the problem. | Subagents and routine work. Users report fast drain of the 5-hour window, whole-file rewrites, and invented tests. 0.20.0 left it out of `availableModels`. |
| Sonnet 5.5 | A plan-following subagent: `implementer`, `reviewer`, `debugger`. | The main agent. |
| Haiku 4.5 | Single-turn, tightly scoped reading or relay work: `test-runner` (from 0.11.0) and background tasks. It supports no effort setting. | Multi-step work. |

### The advisor

0.20 to 0.26 set `advisorModel` to Opus 5.5.
0.27.0 removes it, and `/dotclaude:setup` deletes the 0.26 value.

- The instructions of the advisor tool go in each request.
- The prompt of the tool asks for a call before the work and a call before "done" on each task of several steps.
- Each call reads the whole context without the cache (see [Advisor cost](#advisor-cost)).
- Claude Code 2.1.283 turns the advisor off when it is less capable than the main model.
  A session switched to Fable 5.1 therefore had no advisor.

### Sonnet 5.5

Sonnet 5.5 replaced Sonnet 5 in 0.11.0.

- Anthropic says Sonnet 5 follows instructions literally.
  Anthropic also says that Sonnet 5 prompts work on Sonnet 5.5 without changes.
- Its effort levels are recalibrated.
  At `low`, it sometimes reports a change as done without a check (**official**).
- dotclaude uses it for `implementer`, which took the work of the removed `mechanical-worker` in 0.20.0.
- In 0.27.0, `investigator`, `web-researcher`, `implementer`, and `debugger` use it at `medium`.
  `reviewer` uses Opus 5.5 at `high` ([Parts](Parts#model-and-effort-rules)).
- From 0.17.1 to 0.26, `reviewer` and `debugger` also used it, at `high` until 0.20.0 and at `medium` since.
  In the 0.17.1 evals, they passed the review and debug cases as often as Opus 5.5 at about 55% of the cost ([Eval history](Evals-History)).
- Claude Code has separate weekly limits for Opus and Sonnet on Pro and Max.
  Sonnet agents can therefore continue work after the Opus limit.
- In one test of 35 bug-fix tasks by a user, both models fixed 34.
  Sonnet 5.5 wrote outside its assigned folder 4 times and Opus 5.5 0 times.
  From 0.11.1, the reminder keeps Sonnet 5.5 agents inside the files of their brief.

History of the Sonnet 5.5 effort levels:

| Versions | Levels |
| --- | --- |
| 0.14.1 to 0.16.x | `low` and `medium` only |
| 0.17.0 to 0.19 | also `high` |
| 0.20.0 | `low` and `medium` only ([Parts](Parts#model-and-effort-rules)) |

<details>
<summary>Run costs on this machine (measured)</summary>

- 169 `implementer` runs on Opus 5.5 took 66 calls and $2.50 at the median.
- 28 runs on Sonnet 5 took 50 calls and $1.03.
- The tasks were not the same, and Opus got the slices that needed design judgment.
  This does not test the report that Opus 5.5 takes half the calls.
- These figures count the first streamed record of each message, which undercounts output.
  The re-count in 0.17.0 raised run costs by 5% on Opus 5.5 and 8% on Sonnet 5, so the order stays.
- 196 later Sonnet 5.5 runs took 14 calls and $0.26 at the median, on smaller slices.

</details>

<details>
<summary>Sonnet 5.5 against Opus 5.5 (reported)</summary>

**reported:** The Artificial Analysis suite shows that Sonnet 5.5 costs less per task than Opus 5.5 at the same effort, except at `max`.
But Opus 5.5 one level lower gives a score that is not lower, for less cost, than three Sonnet 5.5 levels.
Each pair is score and cost per task:

| Sonnet 5.5 | Opus 5.5 |
| --- | --- |
| `max` (56, $7.60) | `xhigh` (56, $3.46) |
| `xhigh` (52, $2.74) | `high` (54, $1.82) |
| `medium` (41, $0.59) | `low` (42, $0.55) |

- No Opus level gives a better score for less cost than Sonnet `low` (36, $0.41) or Sonnet `high` (47, $1.08).
- The suite measures output-heavy tasks with small contexts.
  dotclaude subagents spend mostly on cache reads, which cost $0.20 per million tokens on both models.
  The suite therefore overstates the gap for subagents.

**reported:** The ProjectArchitect Bench (2026-09-29) ran an A/B on its own harness.

- On its public coder suite, Sonnet 5.5 at `medium` passed 56 of 56 at about 35% of the Opus 5.5 cost.
  The suite is at its ceiling.
- On its private hard batch of 10 tasks, Sonnet 5.5 at `high` cost as much as Opus 5.5 at `medium` and scored lower.
  The hard tasks are not public and n is small.

**reported:** The release charts of Anthropic (2026-09-28) give score and cost per task at each effort on Terminal-Bench 4.0, FrontierCode 1.1, and CursorBench 4.0.

- Sonnet 5.5 at `high` costs about as much as Opus 5.5 one level lower for about the same score.
- At `xhigh`, Sonnet 5.5 costs more than Opus 5.5 at `high` or `medium` for a score that is not higher.

</details>

## Effort

| Setting | Value and reason |
| --- | --- |
| `maxEffortLevel` | `"xhigh"` in the profile, which blocks only `max`. 0.20 to 0.26 set `high`. The claude.ai effort picker warns that `max` uses about 5.5x the usage on Opus 5.5 and 3.5x on Fable 5.1. |
| `effortLevel` | Not set. A top-level `effortLevel` does not count for Opus 5.5 (**official**, `model-config.md`). |
| `SUBAGENT_EFFORTS` | In `plugins/dotclaude/lib/budget.mjs`: Opus 5.5 and Sonnet 5.5 `low` to `max`, Haiku 4.5 none. The `effort` of each agent file sets the value, and 0.27.0 has no `agent.spawn` check. |

- **binary:** no hook event fires on an effort change, so the main session is not covered.
  The status line shows the model and the effort.
- **official:** Effort can change per turn without a cache miss on Opus 5.5 and Fable 5.1 (code.claude.com/docs/en/prompt-caching).
- **official:** Claude Code defaults Opus 5.5 and Sonnet 5.5 to `medium`.
  The API default is `high` for Sonnet 5.5 and `medium` for Opus 5.5.
  For agentic coding on Sonnet 5.5, Anthropic says to start at `medium` on well-specified tasks.
  Anthropic says to use `high` on harder or longer ones (platform.claude.com/docs/en/build-with-claude/effort).
- **measured:** Issue #96163 reports that Opus 5.5 in `-p` mode writes the whole cache again on every turn.
  The 0.17.1 sweep runs in `-p` mode.
  Opus 5.5 wrote 14k to 17k cache tokens per run against 15k to 16k on Sonnet 5.5, so the sweep does not show it.
- **official:** Medium effort costs about 70% of high for about 2.5 points less.
  xhigh costs about 2.5x high for 1.4 points more.
  Start low and raise effort on failure.

## Related pages

- [Parts](Parts#model-and-effort-rules)
- [Design](Design)
- [Usage evidence](Usage-Evidence)
- [Eval history](Evals-History)
