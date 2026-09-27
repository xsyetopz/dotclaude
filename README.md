# dotclaude

A Claude Code plugin for software engineering with Claude Opus 5.5. Hooks
enforce what can be checked mechanically, an always-on output style sets working
conventions for what can't, and a set of agents and skills covers review,
delegated work, research, and optional Codex workers.

## Install

```text
/plugin marketplace add xsyetopz/dotclaude
/plugin install dotclaude@dotclaude
```

Then run `/dotclaude:apply-settings-profile` and restart Claude Code. A plugin
cannot set permissions, environment variables, or models itself, so this step
writes them into a settings file you choose, after showing you the changes and
making a backup.

Optional integrations (CodeGraph, tgrep, Headroom, fast-compact, the Codex
CLI): ask Claude, for example "set up codegraph for this project", or run
`/dotclaude:setup-integrations`.

Requirements: Claude Code 2.1.283 or later, [Bun](https://bun.sh) 1.4.2 or later
on `PATH`, and git.

## Update

```bash
claude plugin marketplace update dotclaude   # fetch the latest release list
claude plugin update dotclaude@dotclaude     # install it
```

Then, in order:

1. Restart Claude Code. Hooks, agents, and the output style load at session
   start, so a running session keeps the old version.
1. Read the new version's entry in [`CHANGELOG.md`](`CHANGELOG.md`). Before 1.0,
   releases may change or remove behavior without a compatibility layer.
1. Run `/dotclaude:apply-settings-profile` again. It previews every change,
   including any it removes, and backs up the file before writing. A notice at
   session start tells you when your settings are behind the plugin.
1. If you use the Codex agents, run `/dotclaude:setup-integrations codex` again
   to refresh the Codex profiles.

`/plugin` inside Claude Code shows the installed version. To try an unreleased
checkout instead, run `claude --plugin-dir /path/to/dotclaude`.

## What You Get

**Hooks.** Each can be turned off in `/config` under dotclaude.

- **Bash guard**: asks before destructive or public commands (force push,
  `reset --hard`, publishing, `gh` writes, destructive SQL, `curl | sh`), even
  when reworded through `sudo`, `env`, `bash -c`, `eval`, `$(...)`, heredocs, or
  loop bodies. It denies deleting `/` or your home directory.
- **Edit guard**: asks before an edit removes test assertions or adds skip
  markers to an existing test, and before edits to Claude settings, generated
  files, or lockfiles.
- **Quiet in auto mode**: recoverable actions (deleting tracked files, `find`
  deletes, generated-file edits) ask only in attended modes, so an unattended
  session never waits on a prompt nobody sees. Irreversible and public actions
  still ask.
- **Verify-before-stop**: sends Claude, or a subagent, back once when it ends
  after editing code without a test, build, or lint run, or claims tests pass
  after a failure.
- **Compaction carry-over**: after compaction, restores your last messages
  verbatim, the last check result, and which uncommitted files this session
  edited versus everyone else.
- **Model lock**: fast mode stays off. Claude runs on Opus 5.5, Sonnet 5,
  Fable 5.1, or Haiku 4.5. Fable is never a subagent model, and on Pro or a
  standard Team seat without extra usage it is left out, since those plans run
  it on usage credits. Codex commands may name GPT-6 Luna, Sol, or Astra; Astra
  is refused on Plus-sized ChatGPT plans (Plus, Team, Standard Business,
  Enterprise, Edu), and Free and Go do not delegate to Codex.
- **Plan awareness**: dotclaude reads your Claude plan from Claude Code's
  cached account (or the `claude_plan` option) and, at session start, notes
  what it means for model choice: Fable's 50% weekly cap on Max, paid credits
  on Pro, per-token prices on the API, and earlier handoffs on plans with a
  small 5-hour window. Once Codex is set up, it points bounded tasks at
  `codex-worker`, which spends the ChatGPT plan instead of your Claude limits.
  `docs/subscription-tiers.md` holds the research behind these rules.
- **Usage notes**: when Claude Code's cached usage (the same numbers as
  `/usage`, at most an hour old) shows the session or weekly limit past 75% or
  90%, Claude is told once per level and routes the rest of the work to
  stretch what is left.
- **Turn-limit handoff**: an agent that stops at its turn limit is not resumed.
  Its context has grown with every turn, and each further turn re-reads all of
  it. The first message to it is rewritten into a request for a handoff
  report, later messages are blocked, and the work continues in a fresh agent
  briefed from that report.
- **Stalled goals**: when Claude Code's `/goal` check blocks a stop twice in a
  row and Claude did no work in between, the turn ends and the goal pauses,
  with a note that only you can change or end it (`/goal <new condition>`,
  `/goal clear`), instead of up to 9 rounds that each re-read the whole
  context.
- **Tagged messages**: everything dotclaude shows Claude or you starts with
  `[dotclaude]`.

The guards never auto-approve anything and fail open: a bug in dotclaude cannot
stop your work. They are a best-effort parser, not a sandbox; for hard isolation
use Claude Code's [sandbox](https://code.claude.com/docs/en/sandboxing). When a
denied command is really what you want, run it yourself with `! <command>`.

**Output style** (`output-styles/dotclaude.md`). It replaces Claude Code's
built-in coding and git instructions, written in the structure of Anthropic's
own system prompts. It covers:

- grounded claims, with a sanity check in place of answering from memory;
- challenging an approach before building on it;
- the request as the deliverable;
- sharing the working tree with you;
- debugging by measurement;
- verified, complete reports;
- the stops Claude should and should not make;
- delegation to the agents below.

On Fable 5.1, a note adds that model's adjustments, at session start and again
whenever `/model` switches to Fable; switching away retracts it. Every dotclaude
agent is told its turn limit at start and asked to report before reaching it,
and agents on Sonnet 5 are reminded to apply each instruction to everything it
covers, since Sonnet 5 follows instructions literally. The style is
forced on while the plugin is enabled; to use another, disable the plugin or
copy the file to `~/.claude/output-styles/` without `force-for-plugin`.

**Agents.** Claude picks them from their descriptions, or you name one
(`dotclaude:<name>`). Each agent's effort is set in its file, because Claude
Code ignores an effort passed at spawn time.

| Agent | Model, effort | Use it for |
| ----------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `code-reviewer`, `security-reviewer`, `plan-reviewer` | Opus 5.5, high | fresh-context review of a change, its security, or a plan |
| `debugger`, `performance-engineer` | Opus 5.5, high | root cause by measurement; measured speed or memory work |
| `implementer` | Sonnet 5, medium | one well-scoped piece of work (Claude passes `model: "opus"` for a slice that needs design judgment) |
| `test-writer` | Opus 5.5, medium | tests in the repository's style |
| `ci-investigator`, `dependency-auditor` | Opus 5.5, medium | why CI failed; dependency health |
| `mechanical-worker`, `test-runner` | Sonnet 5, low | fully specified bulk edits; failures without the log noise |
| `docs-writer` | Sonnet 5, medium | docs that match a change |
| `history-investigator` | Opus 5.5, low | why code looks the way it does |
| `web-researcher` | Opus 5.5, low | sourced web answers, read from raw pages rather than summaries |
| `integration-setup` | Haiku 4.5 | installing and configuring integrations |
| `codex-worker`, `codex-reviewer` | Haiku 4.5 forwarding to Codex | bounded tasks on GPT-6 Luna; second-opinion review on Astra (Pro plans) or Sol (Plus-sized plans) |

**Skills.**

| Skill | What it does |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `/dotclaude:apply-settings-profile` | applies the settings profile below |
| `/dotclaude:setup-integrations` | installs and configures CodeGraph, tgrep, Headroom, fast-compact, and Codex |
| `codex-fanout` | runs a large, well-specified job on parallel Codex Luna workers sized to your ChatGPT plan; Claude reviews and commits |
| `/dotclaude:review-code-changes` | runs `code-reviewer` on the current changes or a range |
| `write-session-handoff` | writes a note a fresh session can continue from |
| `drive-web-browser`, `recognize-captcha` | browser automation with agent-browser or CloakBrowser; offline CAPTCHA OCR as a fallback |
| `/dotclaude:recap` | "where are we and what are we doing?", checked against git; stops for you to confirm |
| `/dotclaude:challenge`, `/dotclaude:blind-spots` | challenges an idea instead of agreeing; infers your goal and what you are not considering |
| `/dotclaude:troubleshoot` | signal-tracing debugging mode, for after a first fix fails |
| `/dotclaude:fresh-eyes`, `/dotclaude:polish` | re-reviews a new doc or change with a fresh reviewer and fixes it; "what would a perfectionist senior dev reject?" |
| `/dotclaude:lessons-learned` | session post-mortem with concrete changes to apply |

Skills shown with a leading `/` are ones you name. `/dotclaude:<skill>` works
anywhere in a message: at the start Claude Code expands it, and elsewhere a hook
loads the skill with the rest of the message as its input. `recap`, `challenge`,
`blind-spots`, and `lessons-learned` only discuss, so Claude can also load them
when you ask for what they do; the rest, which edit files or run reviewers, run
only when you name them.

## Settings Profile

`/dotclaude:apply-settings-profile` merges
`skills/apply-settings-profile/profiles/recommended.json` into your user,
project, or local settings. It sets:

- **Fast mode off**: fast mode off, `ultracode` off, and the word "ultracode" in
  a prompt no longer starts a workflow.
- **Lean system prompt**: `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`, Claude Code's
  shorter built-in prompt, about 6.6k fewer tokens on every request.
- **Background usage**: compaction at 400k tokens of context (200k on plans
  with a small 5-hour window) instead of about 967k, and no prompt
  suggestions, automatic session recaps, or idle delivery of cross-session
  messages, since each of those sends a request that re-reads the context.
- **Effort cap**: `maxEffortLevel: "xhigh"`, which also caps agents, skills, and
  workflow stages. `max` is blocked because the claude.ai effort picker warns
  that it uses about 5.5x the usage on Opus 5.5 and 3.5x on Fable 5.1 (as of
  2026-09-26); `xhigh` stays for the rare turn where `high` was not enough.
- **Models**: Opus 5.5 as session and advisor model, Sonnet 5 for built-in
  subagents (`general-purpose` and others that set no model of their own);
  `availableModels` of Opus 5.5, Sonnet 5, Fable 5.1, and Haiku 4.5 (without
  Fable on Pro or a standard Team seat with extra usage off); Fable denied as a
  subagent model. Haiku runs Claude Code's background tasks. Re-applying
  removes the 0.4.0 mapping of `sonnet` to Opus 5.5 if it is still there.
- **Subagent and workflow bounds**: 6 subagents at once, and 6 agents at once in
  a workflow run (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`).
  `workflowSizeGuideline: "medium"` asks Claude to aim for fewer than 10 agents
  per workflow; that one is advice, not a cap. Workflows stay on.
- **Tools**: the task-list tools turned on (off by default on Opus 5.5), and
  `AskUserQuestion` denied, which drops about 4.9 KB from every request.
- **Feedback off**: `/feedback`, the SendFeedback tool, the session survey, and
  error reports. Telemetry stays on, because turning it off also stops the
  feature-flag fetch that the advisor tool and large-paste marking need.
- **Permissions**:
  - pre-approval for the two Codex profile commands;
  - read denies for `.env` files and credential directories;
  - bypass mode disabled.
- **Git**: Claude Code's built-in git instructions replaced by the output
  style's.
- **`$schema`**: the documented settings schema, for editor completion.

The merge only adds, except for the model policy (`availableModels` and
`Agent(model:...)` denies), which it replaces. It can also add a short marked
section to `~/.claude/CLAUDE.md`.

The profile sets a ceiling, not a level. Opus 5.5 defaults to medium, which
suits coding; use `/effort high` for hard debugging and planning, and do not set
`CLAUDE_CODE_EFFORT_LEVEL`, which overrides every agent's own effort. No setting
turns off ultracode on its own without also dropping `xhigh` or workflows, so
`/effort ultracode` stays available as a deliberate choice.

The cap in your own settings is one you can remove. To lock it, the skill offers
`install-managed.mjs`, which you run with `sudo` in your own terminal. It writes
`managed-settings.d/50-dotclaude.json` (effort cap, fast mode off, the model
list) next to Claude Code's managed settings, never touches an existing
`managed-settings.json`, validates the file before moving it into place, and
asks before replacing a different one.

## Codex

The Codex agents need the [Codex CLI](https://github.com/openai/codex), logged
in with `! codex login`, and the profiles that
`/dotclaude:setup-integrations codex` installs into `$CODEX_HOME`:

- **`dotclaude-luna.config.toml`**: a bounded worker on GPT-6 Luna at high
  effort. It runs in a workspace-write sandbox where `.git` stays read-only, so
  Claude commits. Subagents, goals, apps, browser use, and the skills catalog
  are off, which cuts Codex's fixed input from about 32 KB to under 5 KB per
  request.
- **`dotclaude-review.config.toml`**: a read-only reviewer on Astra for Pro and
  Pro 5x, and Sol for Plus.
- **`config.toml`**: gets `service_tier = "default"` and fast mode off. On Plus
  it also gets Luna as the base model. Everything else is kept.

Setup also replaces the instructions Codex sends GPT-6. The built-in templates
run 18 to 21 KB, are written for an interactive collaborator (commentary every
60 seconds, persistence wording, sections on apps, plugins, and visualizations),
and much of that works against focused engineering work. Setup copies Codex's
current model catalog into three files,
`dotclaude-catalog-{interactive,worker,review}.json`, with dotclaude's templates
for Astra, Sol, and Luna (a few hundred words each, plus short per-model notes)
and persistent-mode and multi-agent role text removed. `config.toml` points at
the interactive catalog and each profile at its own through
`model_catalog_json`. A catalog stops Codex from refreshing its model list, so
setup fetches the current list itself each time it runs (through a temporary
Codex home that links to your login), and re-running setup picks up new OpenAI
models. `codex review` uses its own built-in review prompt, so on the reviewer's
path dotclaude's review stance comes from the profile's
`developer_instructions`.

The ChatGPT plan is read from the Codex login token's plan claim; no token
leaves the plugin.

## Options

Set in `/config` under dotclaude:

- **Guards and gates**, all on by default: `bash_guard`, `edit_guard`,
  `stop_gate`, `compact_carryover`, `subagent_guidance`, `model_lock`,
  `commit_hygiene`, and `codegraph_hint`. Turn on `ask_in_auto_mode` to be asked
  about recoverable actions in auto mode as well. The dotclaude agents rely on
  `subagent_guidance` for the shared working-tree rules, the progress log, and
  the report format, so turning it off weakens them.
- **Model lists**: `allowed_models` lists the Claude models the lock accepts,
  and `allowed_codex_models` lists the Codex models. The older GPT-5.6 models
  are not in the default list: they cost about twice the Codex credits of
  their GPT-6 counterparts.
- **Claude plan**: `claude_plan` is `auto` by default, which reads the plan
  from Claude Code's cached account; set `pro`, `max_5x`, `max_20x`,
  `team_standard`, `team_premium`, `enterprise`, or `api` to override it.
- **Limits**: `usage_notes` and `turn_limit_handoff`, both on by default.
- **Disk**: `scratchpad_prune_days`, off (`0`) by default. When set, session
  start deletes Claude Code scratchpads and loose entries under
  `/tmp/claude-<uid>` idle for that many days, never the current session's.
- **Browser and CAPTCHA**: `cloakbrowser`, `cloakbrowser_humanize`,
  `cloakbrowser_headless`, and `captcha_ocr_ddddocr` choose the browser backend
  and CAPTCHA fallback.

## Design Notes

- **No banned-phrase lists.** They get routed around with synonyms, so the
  conventions name what each behavior does and why.
- **No hooks that judge tone or architecture.** A regex can't tell a needed
  abstraction from a speculative one, so those live in the output style and the
  reviewers.
- **No prompt-type or agent-type hooks.** They spend usage on every event.
- **Only documented extension points.** dotclaude uses hooks, output styles,
  skills, agents, `userConfig`, and settings keys, and never patches Claude
  Code.

## Development

```bash
just test                    # bun test ./tests/; extra arguments pass through
just lint                    # biome lint
just validate                # claude plugin validate --strict
just check                   # all three
just bump minor --dry-run    # preview a version bump; drop --dry-run to write
claude --plugin-dir . plugin details dotclaude  # inventory and token cost
```

`just bump` (`scripts/bump-version.mjs`) sets the same version in
`.claude-plugin/plugin.json` and `package.json`, refusing when they disagree,
and moves the `[Unreleased]` CHANGELOG entries under a dated heading. CI runs
`biome ci` (lint, format, and import order) and the tests on Linux and macOS;
require its `all-green` check in branch protection.

The behaviour evals in `evals/` run with `claude plugin eval`, which loads the
plugin into Claude Code and repeats each case without it as a baseline.
`bun evals/report.mjs <result.json>` reads its `--json` output and reports
each case as trials passed out of trials run, with a 95% interval, and the
difference with and without the plugin with its own interval. Graders marked
`arm: with-only` are left out of that comparison.

`evals-heldout/` is a second suite written without access to dotclaude's
prompts, so it measures real reported failures rather than dotclaude's own
wording; its README has the freeze rule and the run command.

Tests pass commands to the guard as strings; nothing in the suite executes a
guarded command.

## License

[MIT](LICENSE)
