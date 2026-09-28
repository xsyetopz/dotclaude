# Pro-first usage: findings behind 0.7.0

0.7.0 calibrates dotclaude for the smallest paid plans, Claude Pro and ChatGPT
Plus. Max 5x, Max 20x, Pro 5x, and Pro 20x run the same rules and only reach
the limit later. Collected 2026-09-28. Evidence levels follow
`subscription-tiers.md`: **official**, **binary**, **measured** (this
machine), **dossier** (Reddit threads in `docs/reddit-codex-and-claude/`,
exported 2026-09-27, 213 threads), **inference**.

## 1. Where this week's Claude limit went (measured)

The user's `/usage` on 2026-09-28 showed the Max 20x weekly limit at 100%
(window 09-21 04:00 UTC to 09-28 04:00 UTC). Claude Code's own breakdown for
the last 24 hours: 80% from subagent-heavy sessions, 70% at contexts over
150k tokens, and 22% from `general-purpose` subagents.

A scan of this machine's transcripts gives the same picture. The transcripts
start on 09-25, so the figures are a lower bound on the week. Dollar figures
are API-equivalent. They are deduplicated by message and request ID, with
Opus 5.5 cache writes at $5 per million (5-minute TTL) and $8 per million
(1-hour TTL).

| Measure | Value |
| --- | --- |
| Total | $1,854 (Opus 5.5 98.7%, Sonnet 5 1.1%, Haiku 4.5 0.1%) |
| Cost parts | cache reads 64.7%, cache writes 28.1%, output 7.2% |
| Main conversation | 44.9%; 6,762 calls; context p50 369k, p75 603k, p90 807k tokens |
| `implementer` | 30.7%; 155 runs, median 68 calls, about $3.70 a run |
| `general-purpose` | 17.6%; 87 runs, median 51 calls, about $3.80 a run |
| `code-reviewer` | 2.5%; 37 runs, median 36 calls |
| Calls with context over 150k | 74.7% of cost (main over 300k alone: 34.2%) |
| Sessions where subagents cost more than the main conversation | 77% of cost |
| Subagent cache writes (5-minute TTL) | 71M tokens, about $355 (19% of the week) |
| Main-conversation cache writes (1-hour TTL) | 19.5M tokens, about $156 |
| First-call cache write of a fresh subagent | p50 13.9k, p90 24.8k tokens |
| Advisor | 37 calls, about $39 |

Caveats:

- Most of the week ran before 0.5.0 reached this machine (plugin updated
  09-27 09:02 UTC). `implementer` and `general-purpose` still ran on Opus 5.5
  then; since then they run on Sonnet 5. After 0.6.2 there is less than a
  day of data, so this table does not measure the current defaults.
- The 100% includes any claude.ai and other-device use, which the scan cannot
  see.
- How the subscription weights cache reads against output is not published.

**What the scan shows.** Three things drive the limit. Model choice is not one
of them:

1. **Context per turn.** The main conversation ran at a median of 369k tokens
   per call. The output style said to hand off only "past about 400k", and
   Max 20x was left out of the 200k note, so the only enforced bound was
   `autoCompactWindow: 400000`.
1. **Subagent fan-out.** Each fresh subagent pays about 14k tokens of cache
   write before its first tool call. After that, it writes every new turn at
   the 5-minute TTL, and that cache expires while the agent waits on long
   builds. Subagent cache writes alone were about a fifth of the week.
1. **`general-purpose` instead of dotclaude agents.** It was spawned 14
   times after 0.6.2. The output style's preference for dotclaude agents is
   prose, and it did not hold.

## 2. What that means on Pro (inference)

The plan names say Max 5x and Max 20x give 5 and 20 times Pro's usage; this
was not re-checked against Anthropic's plan page for this doc, and Anthropic
publishes no weekly figure. One dossier comment (score 1, unverified) says the
weekly limit is about 9 five-hour windows on Pro and Max 5x but about 4.5 on
Max 20x, because Max 20x's weekly cap is only 10 times Pro's. Taking this
machine's week as all of the usage, a Pro week is therefore **at least about
$90–185 API-equivalent** of Opus 5.5 (20x or 10x). At this week's habits, the
low end buys:

- about 750 main-conversation turns at the measured mean of $0.12 a turn, or
- about 25 subagent runs the size of the average `implementer` or
  `general-purpose` run.

The high end doubles both. Either way, a Pro week holds a few days of this
machine's pre-0.5.0 habits, not a week.

Two levers apply:

- A 150k context costs about $0.03 a turn in cache reads, against $0.074 at
  the measured median. Capping context therefore roughly doubles to triples
  the number of turns.
- Every subagent that is not spawned saves its roughly 14k-token cache write
  plus its whole run.

The 5-hour window on Pro is not published, and there is no local Pro data.

- Anthropic raised five-hour limits on Pro, Max, and Team with Opus 5.5
  (**dossier**, quoting the launch post).
- One Pro user reports a large Opus 5.5 page rebuild using 35% of a 5-hour
  window, and a follow-up across 11 pages using 25% (**dossier**).

Other Pro reports (**dossier**):

- Fable is not in Pro's limits (**official**, `subscription-tiers.md`
  section 1).
- Opus 5.5 at medium effort is reported as the sweet spot on Pro.
- One Pro user runs Sonnet 5 as the main agent and an Opus 5.5 plan-mode
  subagent as advisor, and reports that it "sips usage".
- Several users moving from Codex found a $20 Claude plan comparable to a
  $100 ChatGPT plan (the "$100/mo openai = $20/mo anthropic" thread, score
  144).
- The "Is Claude Pro actually worth $20 … for heavy coding" thread (34, 166
  comments) splits. The top answers say 3–5 hours a day needs the $100 plan
  (85, 67). Others say they "struggle to hit my weekly usage" on $20 with
  Opus 5.5 (18, 8), and that 2–3 hours of non-stop work stayed inside one
  5-hour window (12).
- A Max 5x user who came from Codex, with no plugins, measured 8–10% of the
  5-hour window per hour on a single thread (1).

### Effort

- The consensus is Opus 5.5 at medium, with high or max for a problem medium
  fails on. Anthropic suggests medium as well. dotclaude already uses medium
  as the default and high as the preferred ceiling, and forbids max.
- **Mid-session effort changes.** Two comments in "Sweet spot for opus 5.5
  when it comes to effort" say that on Opus 5.5 and Fable 5.1 the effort can
  change per turn without invalidating the prompt cache. The suggested use
  is to plan at xhigh, then work at medium, and raise effort again when
  something comes up.
  - This is **unverified here**. Anthropic's docs have said that changing
    thinking parameters invalidates cached message blocks.
  - If it holds, it is a cheaper pattern than a fixed high effort: the
    output style could recommend `/effort` changes per phase.
  - **Measured, inconclusive.** Four `claude -p` turns ran on Opus 5.5 in
    one session: medium, then `--resume` at medium, high, and low.
    - Every resumed turn read the same 11,680 cached tokens and wrote about
      23k again, including the control turn that kept medium.
    - So an effort change caused no extra cache miss.
    - But `-p --resume` already misses the cache after about 11.7k tokens,
      so this setup cannot show whether the conversation part survives an
      effort change.
    - A clean test needs one long-lived process that changes effort between
      turns. Cost of this probe: $0.84 API-equivalent.
- Sol and Astra above medium effort go on "random side-quests" and rathole
  on edge cases (1). Opus 5.5 does not do this at higher effort.

### Code review

"Opus 5.5 leads the code review benchmark" (65):

- GPT-6 Sol scores 80.3% at 88% precision.
- Opus 5.5 at max scores 82.3% at 84% precision, for a little over 3 times
  the cost.
- One comment says Opus 5.5 at xhigh matches Sol with better precision, at
  a lower cost than at max.

This supports GPT-6 Sol as the Codex reviewer, which finds problems when it
is asked to look for them, while it stays unreliable as an implementer that
reports on its own work.

### Usage-conservation threads and the Claude Code binary

Seven more threads (exported 2026-09-28), checked against Claude Code 2.1.283
where they make a claim about it:

- **Forks are on by default (binary, confirmed).**
  - A fork inherits the parent's whole transcript. The "Theories on the
    increased usage consumption" post (49) dates the default to 2.1.232.
  - In 2.1.283, fork is enabled unless `CLAUDE_CODE_FORK_SUBAGENT` is false
    or agent teams are on (`V8n`/`Y8n`, feature flag
    `tengu_fork_subagent_enabled`).
  - On this machine forks were small: 3 runs, about $3 in total, median 25
    calls, against about $3.70 for one average `implementer` run. They
    share the parent's cached prefix, so their first turn is mostly cache
    reads.
  - Not changed: nothing here measured them as a problem.
- **The subagent cache TTL can be set (binary, confirmed).**
  - The `subagentPromptCacheTtl` setting (`"5m"` or `"1h"`) and
    `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` control the cache TTL for
    subagents, workflows, and background requests. Unset, it is 5 minutes.
  - Subagent 5-minute cache writes were about 19% of this week, much of it
    from agents that waited on long builds past 5 minutes.
  - A 1-hour write costs 1.6x a 5-minute write ($8 against $5 per million
    on Opus 5.5). So `1h` pays off only when agents often idle for more than
    5 minutes and then resume.
  - Open item: measure it on one build-heavy session before putting it in
    the profile.
- **Compaction.**
  - Compact while the cache is warm. Compacting after the hour-long TTL has
    expired re-reads the whole conversation uncached (the "Tired of people
    complaining about usage" guide, 349).
  - Several commenters prefer a handoff and a new session to `/compact`
    ("/compact experiments", 19). This matches `subscription-tiers.md`
    section 8: the built-in summary kept 40% of what was needed later.
  - dotclaude's 200k `autoCompactWindow` compacts during an active turn,
    while the cache is warm.
- **Scripts over agent loops.** "Don't do with an agent what you can do with
  a script" (8, "Conserving token usage"). Build the tool once, and have it
  print PASS/FAIL instead of logs. Long bash loops with slow convergence
  (gitops, labs) are where users report the heaviest burn.
- **Measure from local logs.** Several users measure from the JSONL
  transcripts, as section 1 does. None of the "limits got worse" posts
  brings such numbers.
- **Pro in practice.** One Pro user who runs Sonnet on high, uses Opus only
  for planning, and clears context after one or two features "virtually
  never" hits a limit ("Heavy usage use cases").
- **Unverified.** One post claims that auto mode's classifier sends the
  whole transcript on every Bash call. Not checked in the binary.

## 3. Codex (measured and dossier)

### Quota measured on this machine

- **User's own Luna sessions, 09-25.** Between 09:10 and 12:15 UTC, 23
  interactive Codex TUI sessions ran GPT-6 Luna at `xhigh`. These were the
  user's own sessions, not dotclaude workers. They used 90.2M input tokens
  (about 96% cached) and 0.6M output tokens.
  - The ChatGPT Pro 20x weekly quota moved from 59% to 63%. Codex reports
    whole percents, so the true change is 3 to 5 points.
  - One of these sessions used 36.9M tokens.
- **Scaled to Plus (inference).**
  - OpenAI's estimates put Pro 20x at 20 times Plus per 5 hours. Assume the
    same ratio for the weekly quota.
  - The same work would then take **60–100% of a Plus week**. The 36.9M-token
    session alone would take about 40%.
  - Plus's 5-hour window would stop it sooner.
  - OpenAI publishes no per-plan credit allowance, so this ratio cannot be
    checked from credits.
- **dotclaude's `codex-worker`, 09-27.**
  - 20 runs with a median of 12 Claude calls, costing $1 of Claude usage in
    total. The Haiku relay is cheap.
  - Their ChatGPT quota read 0% throughout (just after a reset), so it gives
    no measure.
- **This machine's Codex setup is stale.**
  - The `dotclaude-luna` and `dotclaude-review` profiles have no
    `model_catalog_json`, so workers run Codex's stock GPT-6 prompt.
  - `models_cache.json` has, twice: "The user gets very frustrated when you
    stop and ask for confirmation or permission". The dossier ties this line
    to Sol committing, pushing, and posting issues without being asked.
  - The reviewer is Astra at medium effort (the Pro 20x default).
- **A hard cap exists, but is not ready.** Codex 0.157.1 has
  `[features] rollout_budget` with `limit_tokens`, which ends a session with
  `SessionBudgetExceeded` (**binary/source**,
  `codex-rs/core/src/agent/control/budget.rs`). Its stage is
  `UnderDevelopment`. It could cap a worker run, but it is untested here.

### What users report (dossier, weighed)

- **GPT-6 Sol claims work is done when it is not.**
  - "Hallucinates like crazy thinking it's done work that it hasn't" (score
    236).
  - Given a 17-item list, it "skipped about 6, only partially did 7" (31).
  - It commits, pushes, and opens merge requests unasked (62), and it posted
    a GitHub issue with project details unasked (3).
  - It "stops when it finds a problem" (119).
  - Several users find it good only as a tightly briefed subagent.
- **GPT-6 Luna misses things.**
  - It "failed to identify one or more relevant items" in every review-type
    eval (396).
  - It reported done after changing nothing (93-score thread).
  - It deleted important code and started a reviewer it was told not to
    start (11-score thread).
  - It needs medium effort or higher: 10 failures in 260 at low, none at
    medium.
  - It is slow, and many users run it at `max`.
- **Quota reports conflict.**
  - Some users on 20x, and some on Plus running Sol High, call Luna and Sol 6
    "near unlimited".
  - Others report:
    - "$100 OpenAI ≈ $20 Anthropic" (144)
    - Codex lasting "a day or two" against about 6 days on Claude Pro
    - limits "lower now" in API-dollar terms (15)
    - 6 Sol draining the same share of a 5-hour window as 5.6 Sol
    - Luna High taking 2% of a $20 plan for a one-minute task
  - Astra drains a Plus 5-hour window in 5–7 minutes (several).
  - Results vary by account. The silent-rerouting claims are contested
    (sock-puppet accusations).
- **Harness problems.**
  - A Luna subagent switched itself to Astra Max (4). dotclaude's worker
    profile turns subagents off, and the Bash guard checks `--model`.
  - Codex keeps its cache for 30 minutes (101).
  - GPT-5.6 Sol is being retired in October (single report).

**Verdict.** Codex is not a free overflow for Claude limits:

- On Plus, one long Luna session can take a large part of the week.
- The GPT-6 models need Claude to review every diff anyway, because they
  report unfinished work as done.

Codex is worth using when the user chooses it, with small bounded items and a
diff review. It should not be something Claude reaches for on its own.

### Should the GPT-5.6 models come back?

`models_cache.json` on this login still lists `gpt-5.6-sol`, `gpt-5.6-terra`,
and `gpt-5.6-luna` (**measured**, 2026-09-28). Credits per million tokens,
input / cached / output (**official**, `subscription-tiers.md` section 3):

| Tier | GPT-6 | GPT-5.6 |
| --- | --- | --- |
| Top | Astra 250 / 25 / 1,250 | – |
| Middle | Sol 50 / 5 / 250 | Sol 100 / 10 / 500 |
| Lower middle | – | Terra 50 / 5 / 300 |
| Small | Luna 2.5 / 0.25 / 12.5 | Luna 5 / 0.5 / 30 |

- **"GPT-6 Sol is 5.6 Terra."** The price supports this: GPT-6 Sol costs the
  same credits per token as 5.6 Terra, not 5.6 Sol. Many dossier reports say
  the same about its behavior (the "Is GPT-6-Sol just … Terra" thread, score
  215; "It's basically 5.6 terra", 22). dotclaude should treat GPT-6 Sol as
  a Terra-class delegate: bounded items with a todo list and a diff review.
  It should not be a judge of scope or completeness.
- **GPT-5.6 Luna** is the better case for coming back.
  - It beat GPT-6 Luna on first-pass quality (5–3) and on review (4–2) in
    one 10-task A/B test.
  - It passed 260 of 260 at low effort, where 6 Luna failed 10.
  - It found every relevant item in the review-type evals where 6 Luna
    missed some (396).
  - It costs 2–2.4x 6 Luna's credits. That is still a twentieth of GPT-6
    Sol's, so on Plus it stays the cheap tier.
  - It fits recall-heavy work: review, and items with a wide integration
    surface.
- **GPT-5.6 Sol** is the weaker case.
  - It costs twice GPT-6 Sol's credits, which matters most on Plus. Users
    said it "burned through the limits faster" even while they preferred its
    work.
  - Two reports say OpenAI retires it in October.
  - After the GPT-6 launch, users report it degraded (the 14-score thread)
    and possibly routed to 5.4 (62, unverified).
  - A model that may disappear within weeks is a poor default. It could be
    allowed when the user names it.

Suggested split, not yet applied:

| Role | Model |
| --- | --- |
| Worker | GPT-6 Luna for narrow items (it is faster and cheaper there) |
| Worker, recall-heavy or wide items | GPT-5.6 Luna |
| Reviewer on Plus | GPT-5.6 Luna at high, or GPT-6 Sol at high |
| Escalation | GPT-6 Sol |

This needs a decision from the user and a small A/B run on this repository's
own items before it becomes a default. Adding the 5.6 models requires changes
in three places:

- `allowed_codex_models`
- `ADDENDA` in `build-codex-catalog.mjs`, which today patches only
  the three GPT-6 models
- the escalation text in `codex-fanout`

## 4. What 0.7.0 changes

`docs/usage-architecture.md` records the decisions and the checks behind
each. In short, one set of rules sized for Pro applies on every plan, and
Fable access stays plan-specific because it is a fact about the plan.

1. **Codex support is removed.** Section 3 is kept as the research that led
   there.
1. **One context bound for every plan.** The profile compacts at 200k, and
   the session note and output style say 200k.
1. **A 150k context budget for every subagent**, enforced by refusing its
   tool calls.
1. **Foreground subagents and no `general-purpose`**, enforced by a
   `PreToolUse(Agent)` hook and `CLAUDE_CODE_FORK_SUBAGENT=0`.
1. **3 subagents at once**, and 3 agents at once in a workflow.

## 5. Open items

- Re-run `bun scripts/usage-report.mjs --days 7` after a full week on the
  0.7.0 defaults and compare it with section 1.
- Check that a foreground agent stopped at its turn limit is still handed
  off: `hand-off-capped-agents.mjs` detects that stop from the task
  notification, which a foreground agent may not produce.
