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
| Sonnet 5 | $2 | $10 | $0.20 | $2.50 |
| Haiku 4.5 | $1 | $5 | $0.10 | $1.25 |

- Anthropic publishes no subscription multipliers.
- Cache reads cost the same on Opus 5.5 and Sonnet 5. They were about 65% of
  the measured spend, so a move to Sonnet 5 halves only the writes and the
  output. **inference:** that is about a fifth to a third of subagent cost.
- **measured:** A one-word Fable reply from a fresh `claude -p` context cost
  $0.47. Every fresh Fable context, such as a subagent, pays this fixed cost.

### Model Fit

This section weighs **reported** experience and Anthropic's guidance.

- **Opus 5.5:** the default, at medium effort, and high for hard work. Users
  report that it matches or beats Fable 5.1 on coding at a much lower cost.
- **Fable 5.1:** a planner or advisor in the main conversation, when Opus 5.5
  has not solved the problem. Users report fast drain of the 5-hour window,
  whole-file rewrites, and invented tests. It is not for subagents or routine
  work.
- **Sonnet 5:** a plan-following subagent, not a main agent. Anthropic says
  it follows instructions literally, and reserves `low` effort for short,
  scoped tasks. dotclaude uses it only for fully specified agents
  (`mechanical-worker`, `test-runner`, `docs-writer`, `implementer`) and adds
  a scope reminder.
- **Haiku 4.5:** single-turn, tightly scoped reading or relay work.
  dotclaude uses it only for `integration-setup` and background tasks.

### Effort

- `maxEffortLevel: "xhigh"` blocks `max`. The claude.ai effort picker warns
  that `max` uses about 5.5x the usage on Opus 5.5 and 3.5x on Fable 5.1.
- **reported:** Effort can change per turn without a cache miss on Opus 5.5.
  **measured, inconclusive:** an effort change caused no extra miss. But
  `claude -p --resume` already misses the cache after about 11.7k tokens, so
  the test cannot show whether the conversation part survives. A clean test
  needs one long-lived process.
