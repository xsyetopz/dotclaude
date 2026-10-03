# Agents And Skills

Part of the [dotclaude documentation](README.md).

## Agents

Claude picks an agent from its description, or you name one
(`dotclaude:<name>`).
Since 0.19.0, the working rules route work to agents.
They tell Claude to delegate work whose tool results it does not need later, and to match the work to the agent descriptions.
Each description now says when to delegate, for example "Delegate each slice" for `implementer`.
The old rule kept work in the main conversation, and users reported that the main agent did almost all the work itself.
The reason is in the [design notes](dossier/design.md#the-routing-rule).

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
| `reviewer` | Sonnet 5.5, high | fresh-context, read-only review with a lens from the brief: `code`, `security`, `plan`, `diff` (one agent-loop slice from its diff and `GUIDE.md` only), or `comments` (checks each pull request review comment at its `path:line` and gives a verdict) | Review is judgment. A fresh context does not share the author's assumptions. A reviewer that does not see the implementer's reasoning finds what the implementer rationalized. It has no edit tools. It reads staged changes too, flags weakened checks, and checks that each added package exists, with read-only registry lookups. In the 0.17.1 evals, Sonnet 5.5 at `high` passed the review and debug cases as often as Opus 5.5 at about 55% of the cost ([evals](dossier/evals.md)). |
| `debugger` | Sonnet 5.5, high | root cause by measurement, speed or memory work, delegated when the cause is unclear or a fix failed | A wrong root cause costs more than the extra effort, so it runs at `high`. |
| `reverse-engineer` | Opus 5.5, high | Ghidra analysis of a binary, protocol, or file format, and byte matching | A wrong reading of machine code is hard to find later. It marks each value that it did not recover as `unknown`, so a guess does not look like a finding. It uses the `ghidra` MCP tools of the session, so it has no tool allowlist. |
| `implementer` | Sonnet 5.5, medium | one well-scoped slice with a known check, including its tests and docs, delegated one slice at a time | It follows a plan. Its definition sets its model, and dotclaude removes a `model` that a call gives. |
| `investigator` | Sonnet 5.5, medium | read-only questions that need several files, logs, history, or dependency data, with a lens: `ci` failures, `history` of code, `dependencies` health | It keeps long logs and history out of the main context. It mostly reads, so it runs on the cheaper Sonnet 5.5. |
| `mechanical-worker` | Sonnet 5.5, medium | fully specified bulk edits such as renames, migrations, and codemods | No design judgment. Anthropic's start for well-specified agentic coding on Sonnet 5.5 is `medium`, and at `low` it sometimes skips the check. |
| `test-runner` | Haiku 4.5 | long or slow runs of tests, build, type check, or lint, without log noise | It runs one command, searches the log, and copies the failure lines. It changes no code, so it needs no Sonnet judgment. Haiku costs half as much per token. It loads no `CLAUDE.md` at start and has no MCP tool, so its context starts small. |
| `web-researcher` | Sonnet 5.5, medium | web answers with sources, read from raw pages. It quotes the passage that it cites, and it searches for sources that contradict the claim | Reading and summary, so it runs on the cheaper Sonnet 5.5 at Anthropic's start effort for multi-step tool use. Raw pages keep the source exact. A quote and a search for contradiction guard against a citation that does not say the claim. |

**Why `implementer` is on Sonnet 5.5:** on this machine, 169 `implementer` runs
on Opus 5.5 took 66 tool calls and $2.50 at the median, and 28 runs on
Sonnet 5 took 50 calls and $1.03 (**measured**). The tasks were not the same,
so this is not a controlled test. These figures count each message's first
streamed record, which undercounts output. A re-count with the largest record
raised run costs by 5% on Opus 5.5 and 8% on Sonnet 5, so the order stays.
Sonnet 5.5 replaced Sonnet 5 at the same prices. 196 later runs took 14 calls
and $0.26 at the median, on smaller slices (**measured**). See
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
| `/dotclaude:setup` | applies the [settings profile](settings-profile.md), removes the 0.16 shell function, and installs and configures CodeGraph, tgrep, Betterleaks, semlf, Ghidra, OpenSpec, and `dotclaude-browser` | A plugin cannot set permissions, environment variables, or models. Each integration cuts reads or protects the context. See below. |
| `slices` | runs a large change as slices: implementer, diff-only reviewer, fixer, frozen test oracle. It checks each finding at its `path:line` before a fix agent starts | Bun, GitHub Copilot, and pnpm v12 ported large code bases this way. [Hooks](hooks.md#agent-loop-oracle-guard_edit) enforce the oracle and the review. See the [agent loop](dossier/design.md#the-agent-loop). |
| `contribute` | checks a project's AI policy, verifies the claim, and drafts an issue, pull request, discussion, or comment for you to send | A contribution speaks for you. See [Contributions](contributions.md). |
| `handoff` | writes a note that a fresh session can continue from | A handoff and `/clear` cost less than `/compact` on a large or cold context. |
| `explain` | answers "why did you do that?" from these pages | The reason for each dotclaude behavior is in these pages. |
| `polish` | edits a doc, message, or README section that you name, in place, and lists the kinds of change | A light edit keeps your meaning, voice, structure, terms, and facts. Only you start it, because Claude has no reason to edit a file that you did not name. |
| `drive-web-browser`, `recognize-captcha` | browser automation with agent-browser or CloakBrowser, offline CAPTCHA OCR, in the optional `dotclaude-browser` plugin | The working rules require a browser check of UI changes. Research and tests meet sites with bot checks. CloakBrowser prevents CAPTCHAs, and the offline OCR is a fallback that needs no paid service. A separate plugin keeps the skills and their session note out of sessions that use no browser. |

You name the skills with a leading `/`. You can put `/dotclaude:<skill>`
anywhere in a message. Claude Code then tells Claude that the message names
a skill, and Claude runs it when you ask it to. General
workflow skills are in [xsyetopz/skills](https://github.com/xsyetopz/skills).

### Integrations

All are optional. dotclaude works without them.

- **CodeGraph:** one query returns a symbol's source and its callers, in place
  of many searches and reads. Each read is a turn.
- **tgrep:** indexed search for large repositories.
- **Betterleaks:** the scanner behind
  [secret redaction](hooks.md#secret-redaction-guard_secrets).
- **semlf:** the checker behind the
  [line-break check](hooks-context.md#line-breaks-context_line_breaks).
- **Ghidra:** decompiles binaries for reverse engineering. The MCP server
  `pyghidra-mcp` goes into the one project that needs it, because it starts
  Ghidra's Java process in each session of that project. The `ghidra-bridge`
  CLI is the fallback when the MCP server is missing or fails.
- **OpenSpec:** specs and change proposals in `openspec/`, with `/opsx:*`
  commands for Claude Code. The setup runs only in the project that you name.
  OpenSpec's docs say to commit `openspec/`, so dotclaude does not exclude it.
- **dotclaude-browser:** the browser skills, and a session note that tells
  Claude to load `drive-web-browser` before a browser command. Its options
  (`cloakbrowser`, `cloakbrowser_humanize`, `cloakbrowser_headless`,
  `captcha_ocr_ddddocr`) are in `/config` under dotclaude-browser.
