# dotclaude Dossier: Plans And Models

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

## 4. Plans And Models

### The Fable Limit

Fable is a cap inside the regular weekly limit, not an extra pool.

- **official:** On Max and on Team or Enterprise premium seats, "You can use
  up to 50% of your weekly usage limits on Fable models at no extra cost."
  Fable draws from the regular limit and uses it faster than other models.
- **official:** On Pro and on standard Team or Enterprise seats, Fable runs
  on usage credits from the first message.
- **official:** Usage-based Enterprise and the API pay standard API rates.
- **binary:** The bundle labels the `seven_day_overage_included` limit
  "Fable limit". `/usage` shows it as "Current week (Fable)".
- **reported, not official:** Fable also drains the 5-hour window quickly.
  The binary applies session and weekly limits to every model.

"Fable weekly 0% used" next to "Weekly 82% used" does not mean that Fable has
free headroom. Every model has at most the remaining 18%, and Fable spends it
faster.

### Plan Detection

`claude_plan: auto` reads `~/.claude.json` → `oauthAccount`, without the
keychain token.

| Field | Values seen |
| --- | --- |
| `organizationType` | `claude_max` (others unverified) |
| `organizationRateLimitTier`, `userRateLimitTier` | `default_claude_max_5x`, `default_claude_max_20x`, `default_claude_zero` |
| `billingType`, `hasExtraUsageEnabled` | `stripe_subscription`, `false` |

A Bedrock, Vertex, or Foundry provider, usage-based billing, or an API key
without an OAuth account resolves to `api`. The limit buckets are
`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, and
`seven_day_overage_included` (**binary**). The status line receives only the
first two.

### Per-Plan Policy

`hooks/lib/_plans.mjs` sets this policy for the model lock, the settings
profile, and session start. Fable is never a subagent model.

| Plan | Fable | Session note |
| --- | --- | --- |
| `max_20x`, `max_5x`, `team_premium` | main conversation only | 50% weekly cap, use it for planning or advice |
| `pro`, `team_standard` | left out unless extra usage is on | paid credits, small 5-hour window |
| `api` | allowed | per-token price ratios |
| `enterprise`, unknown | allowed | no Fable note |

### Prices

API list prices per million tokens (**official**):

| Model | Input | Output | Cache read | 5-minute cache write |
| --- | --- | --- | --- | --- |
| Fable 5.1 | $10 | $50 | $0.25 | $12.50 |
| Opus 5.5 | $4 | $20 | $0.20 | $5 |
| Sonnet 5.5 | $2 | $10 | $0.20 | $2.50 |
| Haiku 4.5 | $1 | $5 | $0.10 | $1.25 |

- Anthropic publishes no subscription multipliers.
- Sonnet 5.5 has the same prices as Sonnet 5 (**official**).
- Cache reads cost the same on Opus 5.5 and Sonnet 5.5. They were about 65% of
  the measured spend, so a move to Sonnet 5.5 halves only the writes and the
  output. **inference:** that is about a fifth to a third of subagent cost.
- **official:** A 1-hour cache write costs 2x the input price. Cache reads
  cost 0.1x, but 0.05x on Opus 5.5 and 0.025x on Fable 5.1.
- **official:** In Claude Code, the main conversation's cache lives 1 hour on
  a subscription within its limits and 5 minutes on usage credits or an API
  key. Subagents use 5 minutes. A prompt after the TTL, and a `/compact`
  after it, write the whole context again. dotclaude tells the user when this
  happens on 100k tokens or more.
- **official:** `/model` loses the whole cache. An effort change and the
  advisor toggle keep it. `/rewind` and forks read the existing cache.
- **measured:** A one-word Fable reply from a fresh `claude -p` context cost
  $0.47. Every fresh Fable context, such as a subagent, pays this fixed cost.
- **measured:** An advisor call reads the whole conversation without the
  cache. In one week of this machine's transcripts, 41 advisor calls read
  215k tokens each on average, with no cache reads. That was 2.1% of the
  API-equivalent cost on Opus 5.5. The call's own `usage` leaves the advisor
  out, and `usage.iterations` holds it as an `advisor_message`.

### Model Fit

This section weighs **reported** experience and Anthropic's guidance.

- **Opus 5.5:** the default, at medium effort, and high for hard work. Users
  report that it matches or beats Fable 5.1 on coding at a much lower cost.
- **Fable 5.1:** a planner or advisor in the main conversation, when Opus 5.5
  has not solved the problem. Users report fast drain of the 5-hour window,
  whole-file rewrites, and invented tests. It is not for subagents or routine
  work.
- **The advisor:** the profile keeps `advisorModel` on Opus 5.5. The advisor
  tool's prompt asks for a call before the work and a call before "done" on
  each task of several steps. A Fable advisor would make Fable routine work,
  at 2.5x the price of calls that already read the whole context uncached.
  Claude Code 2.1.283 turns the advisor off when it is less capable than the
  main model, so a session switched to Fable 5.1 has no advisor.
- **Sonnet 5.5:** a plan-following subagent, not a main agent. It replaced
  Sonnet 5 in 0.11.0. Anthropic says Sonnet 5 follows instructions literally,
  and that Sonnet 5 prompts work on Sonnet 5.5 without changes. Its effort
  levels are recalibrated. At `low`, it sometimes reports a change as done
  without a check (**official**). dotclaude uses it only for fully specified
  agents (`mechanical-worker`, `docs-writer`, `implementer`)
  and adds a reminder about scope and checks. **measured:** On this
  machine, 169 `implementer` runs on
  Opus 5.5 took 66 calls and $2.50 at the median, and 28 runs on Sonnet 5
  took 50 calls and $1.03. The tasks were not the same, and Opus got the
  slices that needed design judgment, so this does not test the report that
  Opus 5.5 takes half the calls. `implementer` stays on Sonnet 5.5, which is
  not measured yet. **reported:** On the Artificial Analysis suite, Sonnet 5.5
  costs less per task than Opus 5.5 at the same effort, except at `max`. But
  Opus 5.5 one level lower gives a score that is not lower, for less cost,
  than three Sonnet 5.5 levels. Each pair is score and cost per task:
  Sonnet `max` (56, $7.60) against Opus `xhigh` (56, $3.46), Sonnet `xhigh`
  (52, $2.74) against Opus `high` (54, $1.82), and Sonnet `medium` (41,
  $0.59) against Opus `low` (42, $0.55). No Opus level gives a better score
  for less cost than Sonnet `low` (36, $0.41) or Sonnet `high` (47, $1.08).
  The suite measures output-heavy tasks with small contexts. dotclaude
  subagents spend mostly on cache reads, which cost $0.20 per million tokens
  on both models, so the suite overstates the gap for subagents. Claude Code
  has separate weekly limits for Opus and Sonnet on Pro and Max, so Sonnet
  agents can continue work after the Opus limit. In one
  user's test of 35 bug-fix tasks, both models fixed 34, but Sonnet 5.5 wrote
  outside its assigned folder 4 times and Opus 5.5 0 times. From 0.11.1, the
  reminder keeps Sonnet 5.5 agents inside the files of their brief.
- **Haiku 4.5:** single-turn, tightly scoped reading or relay work.
  dotclaude uses it for `integration-setup`, `test-runner` (from 0.11.0), and
  background tasks. It supports no effort setting.

### Effort

- `maxEffortLevel: "xhigh"` blocks `max`. The claude.ai effort picker warns
  that `max` uses about 5.5x the usage on Opus 5.5 and 3.5x on Fable 5.1.
- **official:** Effort can change per turn without a cache miss on Opus 5.5
  and Fable 5.1 (code.claude.com/docs/en/prompt-caching).
- **official:** Medium effort costs about 70% of high for about 2.5 points
  less. xhigh costs about 2.5x high for 1.4 points more. Start low and raise
  effort on failure.
