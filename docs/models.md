# Models

Part of the [dotclaude documentation](README.md). dotclaude picks each model
for the most quality per unit of usage quota. The evidence is in
[Plans And Models](dossier/plans-and-models.md).

## The Four Models

The model lock (`model_lock`) accepts only these models. A switch or a
subagent call to another model is blocked. `allowed_models` changes the list.

| Model | Role | Why |
| --- | --- | --- |
| Opus 5.5 | the session, the advisor, and most agents | Many subscribers report that it gives the most quality per quota. Users report that it matches or beats Fable 5.1 on coding at a much lower cost. |
| Sonnet 5.5 | cheap delegated subagent work, never the main model | Anthropic says that Sonnet 5 follows instructions literally and that Sonnet 5 prompts work on Sonnet 5.5. dotclaude uses it only for agents that get a full specification. Cache reads cost the same as on Opus 5.5, so it saves only on writes and output. |
| Fable 5.1 | planning or advice in the main conversation, when Opus 5.5 did not solve the problem | Users report that it does too much: whole-file rewrites and invented tests. It costs 2.5 times Opus 5.5 per token and uses up to half of the weekly limit. |
| Haiku 4.5 | background tasks, `integration-setup`, and `test-runner` | the latest small model, for scripted work that needs no judgment |

Older models are left out, because the latest model in each tier gives more
quality for the same quota. The model roles come from community reports
(**reported**) and Anthropic's guidance. The maintainer keeps the collected
reports outside the public repository.

## Fast Mode

**What:** the lock keeps fast mode off. It blocks `/fast` and the settings
that turn it on.

**Why:** dotclaude chooses quality per quota over speed. Fast mode gives the
same model quality at a higher price: $8 and $40 per million input and output
tokens on Opus 5.5, against $4 and $20. On a subscription, it draws from usage
credits from the first request, even when the plan has usage left
(**official**, [fast mode](https://code.claude.com/docs/en/fast-mode)). The
lock also stops Claude or an agent from turning it on.

## Fable And Your Plan

Fable is a cap inside the regular weekly limit, not an extra pool. On Max and
premium Team seats, Fable can use up to 50% of the weekly limit. On Pro and
standard Team seats, Fable runs on usage credits from the first message
(**official**). So:

- Fable is never a subagent model on any plan. A fresh Fable context costs
  about $0.47 before it does any work (**measured**).
- On Pro, or on a standard Team seat without extra usage, the lock leaves
  Fable out, because those plans pay for it with credits.
- The advisor stays on Opus 5.5. A Fable advisor would make Fable routine
  work, at 2.5 times the price, on calls that read the whole context without
  the cache.

**Plan awareness (`claude_plan`):** session start reads your plan from Claude
Code's cached account (`~/.claude.json`, not the keychain token) and tells
Claude what the plan means for model choice.
[Plan detection](dossier/plans-and-models.md#plan-detection) lists the fields.

## Effort

- **Opus 5.5 defaults to medium.** Medium costs about 70% of high for about
  2.5 points less (**official**). Use `/effort high` for hard debugging and
  planning. An effort change keeps the prompt cache.
- **`max` is blocked** (`maxEffortLevel: "xhigh"`). The claude.ai effort
  picker warns that `max` uses about 5.5 times the usage on Opus 5.5.
- **Each agent file sets its effort,** because Claude Code ignores an effort
  passed at spawn time. See [Agents And Skills](agents-and-skills.md).
- **Do not set `CLAUDE_CODE_EFFORT_LEVEL`.** It overrides every agent's
  effort.

## Session Notes For Models

On Fable 5.1, a session note adds that model's adjustments. Agents on
Sonnet 5.5 get a reminder to apply each instruction to everything it covers,
because Sonnet 5 follows instructions literally. The reminder also tells
them to run a real check before "done", because Anthropic says Sonnet 5.5 at
`low` effort sometimes skips it. Every dotclaude agent learns
its turn limit at start, so it can report before the limit stops it.
