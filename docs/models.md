# Models

Part of the [dotclaude documentation](README.md). dotclaude picks each model
for the most quality per unit of usage quota. The evidence is in
[Plans And Models](dossier/plans-and-models.md).

## The Four Models

The model lock (`model_lock`) accepts only these models. A switch or a
subagent call to another model is blocked. `model_allowed` changes the list.
The lock also removes a call's `model` for dotclaude agents, so that each
definition sets its model.

| Model | Role | Why |
| --- | --- | --- |
| Opus 5.5 | the session, the advisor, and most agents | Many subscribers report that it gives the most quality per quota. Users report that it matches or beats Fable 5.1 on coding at a much lower cost. |
| Sonnet 5.5 | cheap delegated subagent work, never the main model | Anthropic says that Sonnet 5 follows instructions literally and that Sonnet 5 prompts work on Sonnet 5.5. dotclaude uses it only for agents that get a full specification. Cache reads cost the same as on Opus 5.5, so it saves only on writes and output. |
| Fable 5.1 | planning or advice in the main conversation, when Opus 5.5 did not solve the problem | Users report that it does too much: whole-file rewrites and invented tests. It costs 2.5 times Opus 5.5 per token and uses up to half of the weekly limit. |
| Haiku 4.5 | background tasks and `test-runner` | The latest small model, for scripted work that needs no judgment. Anthropic recommends it for subagents that a larger model plans for. Its reliable knowledge ends in Feb 2025, so its agents read tool `--help` output instead of memory. |

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

**Plan awareness (`model_plan`):** session start reads your plan from Claude
Code's cached account (`~/.claude.json`, not the keychain token) and tells
Claude what the plan means for model choice.
[Plan detection](dossier/plans-and-models.md#plan-detection) lists the fields.
A login through `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) caches
no account. The plan is then unknown: Claude gets no plan note, and the model
lock keeps Fable on Pro. Set `model_plan` in `/config` for these logins.

## Effort

- **Opus 5.5 defaults to medium.** Medium costs about 70% of high for about
  2.5 points less (**official**). Use `/effort high` for hard debugging and
  planning. An effort change keeps the prompt cache.
- **`max` is blocked** (`maxEffortLevel: "xhigh"`). The claude.ai effort
  picker warns that `max` uses about 5.5 times the usage on Opus 5.5.
- **Each agent file sets its effort,** because Claude Code ignores an effort
  passed at spawn time. See [Agents And Skills](agents-and-skills.md).
- **dotclaude supports only some effort levels for each model:**

  | Model | Supported | Not supported |
  | --- | --- | --- |
  | Opus 5.5 | `low`, `medium`, `high`, `xhigh` | `max` |
  | Sonnet 5.5 | `low`, `medium`, `high` | `xhigh`, `max` |

  At `xhigh` and `max`, Sonnet 5.5 costs more than Opus 5.5 one level lower
  for a score that is not higher
  ([Model Fit](dossier/plans-and-models.md#model-fit)). The model lock
  denies a subagent that would run outside this table, and a
  `claude --model … --effort …` command outside it. A hook cannot see an
  effort change in the main conversation, so the lock cannot stop a main
  session on Sonnet 5.5 at `xhigh`. For an agent from outside dotclaude, the
  lock checks the effort only when the call names a model, and it uses the
  session effort.
- **Haiku 4.5 has no effort setting.** It uses extended thinking with a
  token budget, not adaptive thinking (**official**,
  [Haiku 4.5](https://platform.claude.com/docs/en/models/haiku-4-5/overview)).
  So its agent files set no `effort`. `claude plugin validate` does not
  catch this, so a test does.
- **Do not set `CLAUDE_CODE_EFFORT_LEVEL`.** It overrides every agent's
  effort.

## Session Notes For Models

On Fable 5.1, a session note adds that model's adjustments. Agents on
Sonnet 5.5 get a reminder to apply each instruction to everything it covers,
because Sonnet 5 follows instructions literally. The reminder also tells
them to run a real check before "done", because Anthropic says Sonnet 5.5 at
`low` effort sometimes skips it. It also tells them to write only in the
files that the brief names, because users report that Sonnet 5.5 writes
outside its assigned folder more often than Opus 5.5. Every dotclaude agent
learns its turn limit at start, so it can report before the limit stops it.
