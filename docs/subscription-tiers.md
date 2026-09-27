# Subscription tiers: findings behind 0.5.0

Research for making dotclaude's model routing depend on the user's Claude and
ChatGPT plans. Collected 2026-09-26 against Claude Code 2.1.283 and Codex CLI
0.157.0. Evidence levels are marked: **official** (vendor docs), **binary**
(read from the installed Claude Code or the Codex source), **measured** (run on
this machine), **dossier** (Reddit reports in
`docs/reddit-dossier-anthropic-openai-2026/`), **inference**.

## 1. How the Fable limit works

**Answer: Fable is a cap inside the regular weekly limit, not an extra pool.**

- Official, [Claude Fable models on your plan][fable-plan]:
  - Max, and premium seats on Team and legacy Enterprise: "You can use up to
    50% of your weekly usage limits on Fable models at no extra cost. They draw
    from your plan's regular weekly usage limits and use them faster than other
    Claude models."
  - FAQ: "your use of other models draws from the same usage limits and you can
    never use more than your weekly limit."
  - Pro, and standard Team or Enterprise seats: Fable is not in the plan
    limits and runs on usage credits from the first message.
  - Usage-based Enterprise and the API: standard API rates.
  - After the cap: "keep using Fable models with usage credits, or switch to
    another model."
  - Surfaces: web, mobile, desktop, Cowork, Claude Code (Fable 5.1 needs
    2.1.255 or later), Claude Design, Microsoft 365, Claude Tag.
- Binary: the rate-limit type `seven_day_overage_included` is labeled "Fable
  limit". The `/usage` panel draws it as a per-model row, "Current week
  (Fable)", under "Current week (all models)". The models it covers come from
  the `tengu_usage_overage_included_models` flag, whose default is `["Fable",
  "Fable 5", "Fable 5.1"]`. When it runs out, Claude Code prompts: "continuing
  on Fable uses usage credits".
- The 5-hour session limit is not mentioned on the official page.
  - Binary: session and weekly limits apply to every model.
  - Dossier: many Max users report Fable draining the 5-hour window (for
    example "consumed almost 70% of my 5 hour quota" on one task).
  - Verdict: high confidence that Fable counts toward the 5-hour limit, but
    this is not stated officially.
- Measured, headless `claude -p --output-format stream-json` on this account:
  - A Fable request's `rate_limit_event` carries three windows: `five_hour`,
    `seven_day`, and `seven_day_overage_included`.
  - A Haiku request's event carries only the first two.
  - Utilization is reported in whole-percent steps, so a small probe cannot
    show Fable moving the weekly number.

**Reading the screenshot.** "Fable weekly 0% used" next to "Weekly 82% used"
does not mean Fable headroom is free. Every model, Fable included, has at most
the remaining ~18% of the weekly limit, and Fable spends it faster.

## 2. Plan names

### Claude (binary, plus this machine's `~/.claude.json`)

| Where | Field | Values seen |
| --- | --- | --- |
| Keychain `Claude Code-credentials` → `claudeAiOauth` | `subscriptionType` | `pro`, `max`, `team`, `enterprise` |
| same | `rateLimitTier` | `default_claude_max_5x`, `default_claude_max_20x`, `default_claude_zero` |
| `~/.claude.json` → `oauthAccount` | `organizationType` | `claude_max` here; other values are unverified |
| same | `organizationRateLimitTier`, `userRateLimitTier` | `default_claude_max_20x` here |
| same | `seatTier`, `billingType`, `hasExtraUsageEnabled` | `null`, `stripe_subscription`, `false` here |
| env (set by Claude Code in some child contexts) | `CLAUDE_CODE_SUBSCRIPTION_TYPE`, `CLAUDE_CODE_RATE_LIMIT_TIER` | as above |

Claude Code's own normalization (function in 2.1.283) maps these to `pro`,
`max_5x`, `max_20x`, `max_other`, and `other`. A hook can read
`~/.claude.json` without touching the keychain token.

Limit buckets:

| Bucket | Label |
| --- | --- |
| `five_hour` | session limit |
| `seven_day` | weekly limit (all models) |
| `seven_day_opus` | Opus limit |
| `seven_day_sonnet` | Sonnet limit (shown as "Current week (Sonnet only)" on Max and Team) |
| `seven_day_overage_included` | Fable limit |

The status line's `rate_limits` input exposes `five_hour` and `seven_day` only.

### ChatGPT / Codex (source, `codex-rs/protocol/src/auth.rs`)

- Plan values: `free`, `go`, `plus`, `pro` (Pro 20x), `prolite` (Pro 5x,
  displayed "Pro Lite"), `team`, `self_serve_business_prolite`,
  `self_serve_business_usage_based`, `business`, `enterprise` (also `hc`),
  `edu`, `edu_plus`, `edu_pro`, `enterprise_cbp_*`, `ent26`.
- dotclaude already reads this value as the `chatgpt_plan_type` claim
  (`hooks/lib/_codex.mjs`). `configure-codex.mjs` maps only `plus`, `prolite`,
  and `pro`; every other plan falls to the `unknown` reviewer.

## 3. What each model costs

### Claude API list prices per million tokens (official)

| Model | Input | Output | Cache read | 5-minute cache write |
| --- | --- | --- | --- | --- |
| Fable 5.1 | $10 | $50 | $0.25 | $12.50 |
| Opus 5.5 | $4 | $20 | $0.20 | $5 |
| Sonnet 5 | $2 | $10 | $0.20 | $2.50 |
| Haiku 4.5 | $1 | $5 | $0.10 | $1.25 |

- Anthropic publishes no subscription multipliers. The only official
  statement is that Fable uses limits "faster than other Claude models".
- Price ratio, as a proxy for burn (inference): for input, output, and cache
  writes, Fable costs 2.5x Opus 5.5 and Opus 5.5 costs 2x Sonnet 5. Cache
  reads, about 64% of the measured spend in section 6, cost $0.25 on Fable
  and $0.20 on both Opus 5.5 and Sonnet 5, so the gap in a long session is
  smaller than the headline ratio.
- [How usage and length limits work][usage-limits]: usage depends on
  conversation length and complexity, features and tools, the model, and the
  effort level, and claude.ai, Claude Code, and Claude Desktop share one
  limit. The page gives no numbers.
- Measured: a one-word Fable reply from a fresh `claude -p` context cost $0.47
  API-equivalent. That is the fixed cost of writing Claude Code's system prompt
  and tools into the cache at Fable prices, and every fresh Fable context, such
  as a subagent, pays it.

### Codex (official, [Codex pricing][codex-pricing])

Credits per million tokens (input / cached input / output) and local messages
per 5 hours on Plus:

| Model | Credits | Plus messages per 5 h |
| --- | --- | --- |
| GPT-6 Astra | 250 / 25 / 1,250 | 5–45 |
| GPT-6 Sol | 50 / 5 / 250 | 15–150 |
| GPT-5.6 Sol | 100 / 10 / 500 | 10–100 |
| GPT-5.6 Terra | 50 / 5 / 300 | 25–200 |
| GPT-6 Luna | 2.5 / 0.25 / 12.5 | 350–3,000 |
| GPT-5.6 Luna | 5 / 0.5 / 30 | 250–2,000 |

- Pro 5x and Pro 20x multiply the Plus estimates by 5 and 20.
- "Business ($100) uses the Pro 5x estimates."
- Enterprise and Edu without flexible pricing get the same per-seat limits as
  Plus.
- Models draw from one shared allowance with no per-model quota. This comes
  from a help-center snippet only; the article itself was blocked.
- **The 5.6 fallbacks cost more, not less.** GPT-5.6 Sol costs 2x the credits
  of GPT-6 Sol, and GPT-5.6 Luna 2–2.4x those of GPT-6 Luna.
- Dossier, a single voice: Codex showed one user a notice that 5.6 Sol "was
  not going to be supported much longer".

## 4. Where each model fits (dossier, weighed)

- **Opus 5.5**: the default at medium, high for hard work.
  - Strong consensus that it matches or beats Fable 5.1 on coding at far lower
    burn. Top comment, score 1590: "barely made a dent on my 20X Max
    usage. Quality so far has been better than Fable 5.1".
  - "Forgets everything" means no memory across sessions and drift in long
    chats. The fixes users report are handoff files and a fresh context.
- **Fable 5.1**: worth it only as a planner or advisor in the main session, at
  low or medium effort, when Opus has already failed or the task is open-ended
  design. It is not worth it for subagents, grunt work, or routine review.
  - Recurring complaints: 5-hour windows drained in minutes, whole-file
    rewrites (Anthropic documents this), explanatory notes left in
    deliverables, invented tests, and refusals that fall back to Opus in some
    domains.
- **Sonnet 5**: no report compares it with Opus 5.5; every comparison predates
  Opus 5.5.
  - Reported as token-hungry, splitting work into weak subagents, and poor as
    a main agent.
  - Acceptable as a plan-following implementer, and as a subagent rather
    than the main agent.
  - Anthropic: `low` effort is for short, scoped tasks; instructions are
    followed literally. 0.5.0 therefore uses Sonnet 5 only for dotclaude's
    fully specified, low-judgment agents and keeps judgment-heavy agents on
    Opus 5.5.
- **Haiku 4.5**: only for single-turn, tightly scoped reading, classification,
  or relay work with an "ambiguous: stop and report" exit. This matches the
  0.3.0 decision to take web research off Haiku. No thread measures Haiku's
  effect on subscription limits.
- **GPT-6 Luna**: the cheap worker for narrow, bounded implementation.
  - It misses items in recall-heavy review and reranking. The top post, score
    396, says it "failed to identify one or more relevant items".
  - It needs medium or higher effort; one tester had it fail 10 of 260 tasks
    at low.
  - GPT-5.6 Luna wins wide-integration and review work (A/B test: 5–3 on
    first-pass quality, 4–2 on review).
- **GPT-6 Sol**: suited to bounded work such as CI fixes and specified tasks.
  - It claims unfinished work is done and skips items on long lists. The fix
    users report is an explicit todo list followed by an audit pass.
  - GPT-5.6 Sol is reported better at tool use and one-shot hard tasks, at 2x
    the credits.
- **GPT-6 Astra**: a planner and reviewer only.
  - It drains Plus in minutes ("burned all 5-hour limit in 7 minutes" at
    low), so never use it on Plus.
  - The "98% cheaper" orchestration package used DeepSeek workers, and its
    n=4 counter-test found more regressions.

## 5. Design

### Levers that exist

- Agent frontmatter `model:` and `effort:` are static files; they cannot change
  per user.
- The Agent tool's `model` parameter takes only `sonnet`, `opus`, `haiku`, or
  `fable` (binary). These aliases resolve through
  `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`.
- The per-tier levers are therefore:
  - the settings profile (`availableModels`, `model`, `advisorModel`,
    `CLAUDE_CODE_SUBAGENT_MODEL`, alias env vars, and `Agent(model:...)`
    denies)
  - the `allowed_models` and `allowed_codex_models` defaults
  - session-start notes
  - the Codex profiles written by `configure-codex.mjs`

### What 0.5.0 ships

1. `claude_plan` option: `auto` (default), `pro`, `max_5x`, `max_20x`,
   `team_standard`, `team_premium`, `enterprise`, `api`.
   - `auto` reads `~/.claude.json` → `oauthAccount` (`organizationType`,
     rate-limit tier, `billingType`, `hasExtraUsageEnabled`).
   - A Bedrock, Vertex, or Foundry provider, usage-based billing, or an API
     key with no OAuth account resolves to `api`.
1. Per-plan policy (`hooks/lib/_plans.mjs`), used by the model lock, the
   settings profile, and session start:

   | Plan | Fable | Session note |
   | --- | --- | --- |
   | `max_20x`, `max_5x`, `team_premium` | main conversation only | 50% weekly cap; use for planning or advice |
   | `pro`, `team_standard` | left out unless extra usage is on | paid credits; small 5-hour window |
   | `api` | allowed | per-token price ratios |
   | `enterprise`, unknown | allowed | none about Fable |

1. Fable is denied as a subagent model on every plan.
1. The Fable note carries Anthropic's targeted-edit sentence.
1. Sonnet 5 is allowed normally. `mechanical-worker` and `test-runner` run on
   Sonnet 5 at low effort, and `docs-writer` and `implementer` at medium
   (`model: "opus"` for a slice that needs design judgment). Built-in agents
   that set no model of their own run on Sonnet 5 via
   `CLAUDE_CODE_SUBAGENT_MODEL`.
   - Anthropic reserves `low` for "short, scoped tasks … not
     intelligence-sensitive".
   - Sonnet 5 follows instructions literally, so its subagents get a scope
     reminder.
   - Opus 5.5 and Sonnet 5 share the tokenizer introduced with Opus 4.7
     (inference from the models overview), so Sonnet 5 costs half as much for
     the same text on input, output, and cache writes, and the same on cache
     reads.
1. Codex plan groups: `none` (Free, Go: no delegation), `plus` (Plus, Team,
   Business, Enterprise, Edu: Sol reviewer, no Astra), `pro5x` (Pro 5x, $100
   self-serve Business), `pro20x` (Pro 20x).
   - The GPT-5.6 models are not used: they cost about twice the credits of
     their GPT-6 counterparts.
1. Once Codex is set up, a session note points bounded tasks at
   `codex-worker`, which spends the ChatGPT plan instead of Claude limits.
1. Turn limits and context:
   - Every dotclaude agent is told its `maxTurns` and asked to report before
     reaching it.
   - The output style asks for briefs sized to the turn limit, prompt resumes,
     dotclaude agents over `general-purpose`, and a handoff past about 400k
     tokens of main context.
   - On small-window plans, the handoff comes at about 200k.

1. Enforced turn-limit handoff: the first `SendMessage` to an agent that
   stopped at its limit becomes a report request, and later ones are denied
   in favour of a fresh agent.
1. Usage notes at 75% and 90% of the session or weekly limit, from Claude
   Code's cached `/usage` numbers.
1. Every dotclaude message starts with `[dotclaude]`.

## 6. Session evidence from `~/.claude/`

Transcripts on disk cover only 2026-09-25 and 2026-09-26. Dollar figures are
API-equivalent; how Max weights cache reads is unverified.

- **Model mix.** 22,235 of 22,436 API calls ran on Opus 5.5. Fable made none,
  Haiku made 170 (web research and the guide agent), Codex agents made none.
- **Cost driver: turns times context, not model or output.**
  - Cache reads were about 64% of the total, roughly $1,570.
  - Median main-thread context per turn: 480–550k tokens in the four biggest
    sessions.
  - About 19.7k of 23k tool calls were Bash, and each one is a full-context
    turn.
- **Where the money went.**
  - Main thread: about $704.
  - `implementer`: $463 over 132 runs, median context 146k.
  - `general-purpose`: $308 over 87 runs, for work a dotclaude agent covers.
  - `code-reviewer`: $38.
- **Advisor.** 27 calls, each sending 700–930k tokens of uncached input
  (about $31). Top-level `usage.input_tokens` leaves these out; they appear
  only under `usage.iterations`.
- **Turn-limit hits.** 53 unique hits: 39 `implementer` at 80 turns and 8
  `code-reviewer` at 40. A raw grep counts more, 630 messages across caps 30
  to 80, because the text repeats across records.
  - The parent then resumed or respawned the agent, usually after the
    5-minute cache had expired.
  - That caused 40 subagent cache rebuilds of over 50k tokens each (8.4M
    tokens).
- **No limit errors.** No session, weekly, Fable, or credit-limit messages
  and no 429s. There were 33 "Concurrent subagent limit reached" errors in
  one session.
- **Model-lock friction.**
  - `availableModels` rewrote a `sonnet` request to Opus (session `9733d827`).
  - The hook denied `model: sonnet` 5 times (session `48009116`).

**Turns per task, across resumes** (API calls per subagent transcript):

| Agent | Tasks | Turns p50 / p75 / p90 / max | Median context per turn |
| --- | --- | --- | --- |
| `implementer` (cap 80) | 130 | 68 / 92 / 115 / 320 | 137k; 181k in tasks over 80 turns; 856k max |
| `general-purpose` (no cap) | 75 | 55 / 123 / 151 / 199 | 139k |
| `code-reviewer` (cap 40) | 31 | 34 / 42 / 43 / 46 | 80k |

- A task's cache-read cost is the sum of its per-turn contexts. Context grows
  with every turn, so cost grows with the square of task length.
- Resuming a capped agent keeps that growth going. A fresh agent briefed from
  a report starts small.
- Estimate (inference): splitting a 115-turn task in two cuts its cache reads
  by roughly 25–30%.
- Claude Code delivers no report from an agent cut off at its limit ("It was
  still calling tools and had produced no report"). 0.5.0 therefore tells
  agents their limit up front, and rewrites the first message to a capped
  agent into a report request.
- The up-front notice did not work. Of the 13 capped runs in the first day
  after 0.5.0 (`implementer`, `code-reviewer`, `debugger`,
  `performance-engineer`), none reported before the cap; all were still
  calling tools. 0.6.2 enforces it: when about 5% of the limit (at least 3
  turns) remains, a hook refuses every tool except `SubagentHandback`.
- Claude Code counts the limit per invocation. Every prompt, `SendMessage`
  resume, and background-task wake-up starts the count again, which is why
  resumed runs reach 100–380 API calls under a cap of 80.
- `code-reviewer` went from 40 to 60 turns in 0.6.2. Its median run used 36
  calls, 3 of 6 runs since 0.5.0 hit the cap, and a capped review loses its
  findings, while a capped `implementer` only splits its work.

**Model moves and their limit.** Cache reads cost $0.20 per million on both
Opus 5.5 and Sonnet 5, so moving `implementer` and the built-in agents to
Sonnet 5 halves only their cache writes and output. On the scanned spend
(subagents: $542 reads, $312 writes, output undercounted), that is roughly a
fifth to a third of subagent cost. If Sonnet uses 1.2–1.5x the tokens, as
users report, the saving shrinks further. Context size and turn count stay
the bigger lever.

**Takeaway (inference).** On this account, model choice is the second lever.
The first is context size and turn count:

- smaller slices per `implementer` run
- a handoff or compaction before the main thread passes about 400k tokens
- advisor calls only at decision points
- dotclaude agents in place of `general-purpose`

## 7. Dossier claims that look off

- A cold cache costing "10 times more … on opus and 40 times on 5.1": the
  official cache-read and cache-write multipliers do not produce these ratios.
- Fable 5.1 at "$25/$50": the official price is $10/$50.
- "Run out of the whole month of credits. ON MAX": Max has 5-hour and weekly
  windows. This probably describes extra-usage credits.
- The "Fable 5.1 all day" post (score 662): commenters flagged it as
  AI-written, posted about 3 hours after launch.
- The Astra orchestration post (score 1190): accused of bought upvotes, and
  its savings mostly come from using Astra less.
- A one-letter Haiku skill "for keeping the cache warm": caches are per model,
  so a Haiku ping cannot keep an Opus or Fable cache warm.

[fable-plan]: https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
[codex-pricing]: https://developers.openai.com/codex/pricing
[usage-limits]: https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work

## 8. Compaction eval: fast-compact vs built-in `/compact` (2026-09-27)

Run on this machine's transcripts, with no Claude usage.

**The fast-compact bench, on 28 of our points** (`bun bench/run.ts --jev`,
TypeSafe `jev-latest`; 20 points answered, 8 failed at the API):

- Upstream `fast-jev-compaction` as shipped kept 0% of old tool output. It
  dropped 1,920 of 1,943 calls.
- `fast-compact` as shipped keeps 55% of the size, 52% of needed tokens,
  and 63% of needed outputs.
- The same rule with the newest outputs kept whole and no Jev keeps 58%,
  54%, and 63%.
- Jev's ranking scored AUC 0.51–0.55 per point, near a coin flip. Plain
  "largest first" scored 0.74.

**Built-in compaction, replayed on the 5 real compactions in the scan**
(2 sessions; the script is in the session scratchpad as
`compact_eval.py`):

- The token label is the bench's own: a path, number, or identifier of 8 or
  more characters that a tool result introduced and the assistant used
  within 40 calls after compacting.
- 70 such tokens were needed.

| | Kept in context | Re-fetched by a tool call | Neither | Context left |
| --- | --- | --- | --- | --- |
| Built-in `/compact` | 28 (40%) | 26 (37%) | 16 (23%) | 18k–25k of about 970k tokens |
| fast-compact rule, same history | 58 (83%) | 12 (17%) from its cut files | – | 72–91% of characters |

**Verdict:**

- "Instant compaction" is false as a replacement for compaction. fast-compact
  trims only old tool output and keeps the conversation word for word, so a
  session near 1M stays at 72–91% and every later turn re-reads that much.
- "Nothing gets lost" is mostly true. It keeps 83% of what is needed, against
  the built-in summary's 40%, and the rest is one read away.
- For usage, built-in compaction wins by far. The re-reads it causes cost a
  few thousand tokens each, against about 750k extra re-read on every turn.
- Jev adds no measurable gain on our data.
- Caveats: the sample is small (5 compactions, 28 bench points), the label is
  a token proxy the bench's blind check agreed with 71% of the time, and the
  "Neither" row covers tokens that reached Claude some other way (hook
  context, files, paraphrase).
