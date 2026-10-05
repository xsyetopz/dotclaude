# Release 0.5

Released 2026-09-26 (0.5.0) and 2026-09-27 (0.5.1).
Makes dotclaude aware of the Claude plan and cuts the cost of long agent runs.
0.5.0 puts Sonnet 5 back on the cheaper agents, and adds plan notes, turn-limit handoff, and usage notes.
0.5.1 stops a `/goal` loop that wasted turns.
This line requires Claude Code v2.1.283 or later.

> **Note:** [Plans and models](Plans-and-Models) has the research behind this release, which `docs/subscription-tiers.md` held.
> It covers how the Fable limit works, plan names in Claude Code and Codex, prices, dossier findings, and a scan of real session usage.

To update:

1. Restart Claude Code.
1. Run `/dotclaude:apply-settings-profile` again.
   It adds Sonnet 5 to `availableModels`, replaces the Sonnet deny with Fable denies, and removes the 0.4.0 mapping of `sonnet` to Opus 5.5.
1. If you set `allowed_models` yourself, add `claude-sonnet-5` to it.
1. If you use the Codex agents, run `/dotclaude:setup-integrations codex` again.

## Added

- Claude plan awareness: the `claude_plan` option (default `auto`) reads the plan from the account that Claude Code caches in `~/.claude.json`.
  It uses `organizationType`, the rate-limit tier, `billingType`, and `hasExtraUsageEnabled`, and it never touches the token.
  - Plans: `pro`, `max_5x`, `max_20x`, `team_standard`, `team_premium`, `enterprise`, `api`.
  - A session-start note says what the plan means for model choice:
    - Max and premium seats: Fable draws up to 50% of the same weekly limit as every other model.
    - Pro: Fable runs on paid credits.
    - API: per-token price ratios.
    - Plans with a small 5-hour window: hand off or compact earlier.
- Codex session note: after Codex setup, a note points bounded, fully specified tasks at `codex-worker`.
  It uses the quota of the ChatGPT plan instead of the quota of Claude.
- Agent turn limits: each dotclaude agent learns its `maxTurns` at start and writes its report before it reaches the limit.
  The transcripts that the release scanned showed 39 `implementer` runs and 8 `code-reviewer` runs that stopped at their limit.
- Sonnet 5 scope reminder: agents on Sonnet 5 get it, because Sonnet 5 follows instructions literally (Anthropic's prompting guide).
- Turn-limit handoff (`turn_limit_handoff`, on by default): Claude does not resume an agent that stopped at its turn limit.
  - The hook rewrites the first `SendMessage` to that agent into a request for a handoff report.
    It denies later messages and points at a fresh agent.
  - Reason: a resumed agent keeps its whole context, and every turn re-reads it.
    In the scanned transcripts, `implementer` tasks ran a median of 68 turns (90th percentile 115, maximum 320), with context up to 856k.
- Usage notes (`usage_notes`, on by default):
  - They read the `/usage` numbers that Claude Code caches in `~/.claude.json`, at most an hour old, including the Fable cap.
  - They tell Claude once when the session or weekly limit passes 75%, and again at 90%.
  - They read no token and get nothing.
- Message prefix: each message that dotclaude shows to Claude or the user starts with `[dotclaude]`.
- Goal loop guard (0.5.1, `goal_loop_guard`, on by default): a `/goal` with an unmet condition no longer burns turns after Claude has been told to stop.
  - Reason: Claude Code's goal check blocks every stop.
    In one session, Claude replied "I'm staying stopped" to 9 blocks in a row until Claude Code gave up, and each round re-read about 710k tokens of context.
  - A new Stop hook ends the turn after two goal blocks in a row with no tool call between them.
    Claude Code then pauses the goal.
    The note names `/goal <new condition>` to change the goal, `/goal clear` to end it, and a message to resume.
  - The output style tells Claude to propose a replacement condition with `ProposeGoal` when a goal no longer matches the user's request.
    Otherwise it names those commands once, instead of restating that it is stopping.

## Changed

- Sonnet 5: allowed again in the default `allowed_models`, in the profile's `availableModels`, and in the managed drop-in.
  The `sonnet` alias no longer maps to Opus 5.5.
- `implementer`: runs on Sonnet 5 at medium effort.
  Claude passes `model: "opus"` for a slice that needs design judgment or failed on Sonnet.
- `CLAUDE_CODE_SUBAGENT_MODEL`: the profile now sets Sonnet 5.
  The built-in `general-purpose`, `Explore`, and `Plan` agents run on it.
- `mechanical-worker`, `test-runner`, `docs-writer`: `mechanical-worker` and `test-runner` run on Sonnet 5 at low effort, and `docs-writer` at medium effort.
  They were Opus 5.5 at low effort.
  Sonnet 5 costs half as much as Opus 5.5 for input, output, and cache writes, and cache reads cost the same on both.
- Fable: denied as a subagent model on every plan.
  A fresh Fable context costs about $0.47 API-equivalent before any work, measured with `claude -p`.
- Pro and standard Team: with extra usage off, the model lock and the profile's `availableModels` leave Fable out.
- Fable note: adds Anthropic's instruction to edit files surgically and not to rewrite them.
- Output style: asks for these.
  - dotclaude agents over `general-purpose`
  - briefs sized to finish well inside the turn limit of an agent
  - a fresh agent, briefed from the handoff report, when an agent stops at its turn limit, and no resume
  - a handoff or compaction once the main context passes about 400k tokens
- Codex plans: groups by quota.
  - Pro 5x and the $100 self-serve Business plan review with Astra.
  - Team, Standard Business, Enterprise, and Edu get the Plus rules: Sol reviewer, no Astra.
  - Free and Go do not delegate to Codex.
  - The GPT-5.6 models stay out of the defaults, because they cost about twice the credits of their GPT-6 counterparts.

Previous: [Release 0.4](Release-0.4) · Next: [Release 0.6](Release-0.6)
