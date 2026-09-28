# Agents And Skills

Part of the [dotclaude documentation](README.md).

## Agents

Claude picks an agent from its description, or you name one
(`dotclaude:<name>`). The working rules keep work in the main conversation by
default, and they use an agent only when its output would fill the context,
for parallel work that you ask for, or for a fresh-context review.

**Why so few agents:** each fresh subagent writes about 14k tokens to the
cache before its first tool call, and its 5-minute cache can expire while it
waits on a long build. Subagents were over half of the measured week's cost
([usage evidence](dossier/usage.md)).

**Why dotclaude agents and not `general-purpose`:** `general-purpose` runs
were 17.6% of the measured cost. The output style asked Claude to prefer the
dotclaude agents, and that request did not hold. A hook now refuses
`general-purpose` and names the dotclaude agent for the job.

**Why each agent file sets its effort:** Claude Code ignores an effort passed
at spawn time. The effort matches the judgment that the job needs: high for
review and root cause, low for reading, relay, and fully specified edits.
Anthropic's guidance is to start low and raise effort on failure.

| Agent | Model, effort | Use | Why this model |
| --- | --- | --- | --- |
| `code-reviewer`, `security-reviewer`, `plan-reviewer` | Opus 5.5, high | fresh-context review of a change, its security, or a plan | Review is judgment. A fresh context does not share the author's assumptions. |
| `debugger`, `performance-engineer` | Opus 5.5, high | root cause by measurement, speed or memory work | A wrong root cause costs more than the extra effort. |
| `implementer` | Sonnet 5, medium | one well-scoped piece of work | It follows a plan. `model: "opus"` gives it design judgment when a slice needs it. |
| `test-writer` | Opus 5.5, medium | tests in the repository's style | Expected values need judgment that is independent of the code. |
| `ci-investigator`, `dependency-auditor` | Opus 5.5, medium | CI failures, dependency health | They keep long logs out of the main context. |
| `mechanical-worker`, `test-runner` | Sonnet 5, low | fully specified bulk edits, test runs without log noise | No design judgment. Anthropic keeps `low` for short, scoped tasks. |
| `docs-writer` | Sonnet 5, medium | docs that match a change | The change gives the content. |
| `history-investigator` | Opus 5.5, low | why code looks the way it does | Reading and summary. |
| `web-researcher` | Opus 5.5, low | web answers with sources, read from raw pages | Reading and summary. Raw pages keep the source exact. |
| `integration-setup` | Haiku 4.5 | integration install and setup | Scripted steps. |

**Why `implementer` is on Sonnet 5:** on this machine, 169 `implementer` runs
on Opus 5.5 took 66 tool calls and $2.50 at the median, and 28 runs on
Sonnet 5 took 50 calls and $1.03 (**measured**). The tasks were not the same,
so this is not a controlled test. See
[Model Fit](dossier/plans-and-models.md#model-fit).

**Why subagents run in the foreground:** a background agent wakes the main
conversation when it finishes, and each wake is a full turn over the whole
context. Background agents started 501 of 861 main turns in the measured
week. Agents spawned in one message still run together.

**Why an agent reports before its turn limit:** Claude Code delivers nothing
from an agent that it stops at its turn limit. See
[turn-limit handoff](dossier/design.md#turn-limit-handoff).

## Skills

| Skill | Use | Why it is in dotclaude |
| --- | --- | --- |
| `/dotclaude:apply-settings-profile` | applies the [settings profile](settings-profile.md) | A plugin cannot set permissions, environment variables, or models. |
| `/dotclaude:setup-integrations` | installs and configures CodeGraph, tgrep, fast-compact, and gitleaks | Each one cuts reads or protects the context. See below. |
| `write-session-handoff` | writes a note that a fresh session can continue from | A handoff and `/clear` cost less than `/compact` on a large or cold context. |
| `explain-dotclaude` | answers "why did you do that?" from these pages | The reason for each dotclaude behavior is in these pages. |
| `drive-web-browser`, `recognize-captcha` | browser automation with agent-browser or CloakBrowser, offline CAPTCHA OCR | The working rules require a browser check of UI changes. Research and tests meet sites with bot checks. CloakBrowser prevents CAPTCHAs, and the offline OCR is a fallback that needs no paid service. |

You name the skills with a leading `/`. You can put `/dotclaude:<skill>`
anywhere in a message. A user-only skill must start the message. General
workflow skills are in [xsyetopz/skills](https://github.com/xsyetopz/skills).

### Integrations

All are optional. dotclaude works without them.

- **CodeGraph:** one query returns a symbol's source and its callers, in place
  of many searches and reads. Each read is a turn.
- **tgrep:** indexed search for large repositories.
- **fast-compact:** trims only old tool output. In 5 replayed compactions it
  kept 83% of the facts that Claude used next, against 40% for `/compact`.
  But it leaves 72–91% of the context, so every later turn costs more. It is
  for work where lost facts cost more than usage ([evals](dossier/evals.md)).
- **gitleaks:** the scanner behind
  [secret redaction](hooks.md#secret-redaction-secret_redaction).
