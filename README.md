# dotclaude

A Claude Code plugin for software engineering with Claude Opus 5.5. Hooks
enforce what can be checked mechanically, a replacement system prompt and an
always-on output style set working conventions for what can't, and a set of
agents and skills covers review, delegated work, and research.

## Install

```text
/plugin marketplace add xsyetopz/dotclaude
/plugin install dotclaude@dotclaude
```

Then run `/dotclaude:apply-settings-profile` and restart Claude Code. A plugin
cannot set permissions, environment variables, or models itself, so this step
writes them into a settings file you choose, after showing you the changes and
making a backup.

Optional integrations (CodeGraph, tgrep, Headroom, fast-compact): ask Claude,
for example "set up codegraph for this project", or run
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

`/plugin` inside Claude Code shows the installed version. To try an unreleased
checkout instead, run `claude --plugin-dir /path/to/dotclaude`.

## What You Get

**Hooks.** Each can be turned off in `/config` under dotclaude.

- **Bash guard**: asks before destructive or public commands (force push,
  `reset --hard`, publishing, `gh` writes, destructive SQL, `curl | sh`), even
  when reworded through `sudo`, `env`, `bash -c`, `eval`, `$(...)`, heredocs, or
  loop bodies. It denies deleting `/` or your home directory, and recursive
  searches that would walk gitignored build output or dependencies (`grep -r`,
  `find`, `tree`, `rg --no-ignore`, `fd -I`); plain `rg`, `fd`, and `git grep`
  skip those directories.
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
  it on usage credits.
- **Plan awareness**: dotclaude reads your Claude plan from Claude Code's
  cached account (or the `claude_plan` option) and, at session start, notes
  what it means for model choice: Fable's 50% weekly cap on Max, paid credits
  on Pro, and per-token prices on the API. The limits on context and fan-out
  are sized for Pro and apply on every plan; Max only runs out later.
  `docs/subscription-tiers.md` and `docs/pro-first-usage.md` hold the research
  behind these rules.
- **Usage notes**: when Claude Code's cached usage (the same numbers as
  `/usage`, at most an hour old) shows the session or weekly limit past 75% or
  90%, Claude is told once per level and routes the rest of the work to
  stretch what is left. When a turn stops on a usage limit, a terminal
  notification names the limit, when it resets, and the `claude --resume`
  command for the session (in terminals that show OSC 9, 99, or 777
  notifications).
- **Turn-limit handoff**: a dotclaude agent is refused tool calls once about
  5% of its turn limit remains, so its next action is its report; Claude Code
  delivers nothing from an agent cut off at the limit. An agent that stops at
  its limit anyway is not resumed: its context has grown with every turn, and
  each further turn re-reads all of it. The first message to it is rewritten
  into a request for a handoff report, later messages are blocked, and the
  work continues in a fresh agent briefed from that report.
- **Stalled goals**: when Claude Code's `/goal` check blocks a stop twice in a
  row and Claude did no work in between, the turn ends and the goal pauses,
  with a note that only you can change or end it (`/goal <new condition>`,
  `/goal clear`), instead of up to 9 rounds that each re-read the whole
  context.
- **Instruction-file lint**: at session start, a warning when an
  instruction file passes 150 lines, and a failure when it passes 200. The
  check covers every `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, and
  `.claude/rules/` file and every file they `@import`, without block-level
  HTML comments. The instructions that load at session start get a warning
  above about 3,000 tokens together, and a failure above 5,000. A file above
  4 MiB, an import more than four hops deep, and an `AGENTS.md` that a
  `CLAUDE.md` hides without `@AGENTS.md` are also reported. Names symlinked
  to one file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) are checked once, under
  the original's path. A symlink to a missing file gets its own warning.
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
agent is told its turn limit at start and when its tool calls will be refused,
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

**Skills.**

| Skill | What it does |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `/dotclaude:apply-settings-profile` | applies the settings profile below |
| `/dotclaude:setup-integrations` | installs and configures CodeGraph, tgrep, Headroom, and fast-compact |
| `write-session-handoff` | writes a note a fresh session can continue from |
| `drive-web-browser`, `recognize-captcha` | browser automation with agent-browser or CloakBrowser; offline CAPTCHA OCR as a fallback |

Skills shown with a leading `/` are ones you name. `/dotclaude:<skill>` works
anywhere in a message: at the start Claude Code expands it, and elsewhere a hook
has Claude load it through the Skill tool, with the rest of the message as its
input. A user-only skill still has to start the message. dotclaude ships
only the skills its own features need; general workflow skills live in
[xsyetopz/skills](https://github.com/xsyetopz/skills).

## Settings Profile

`/dotclaude:apply-settings-profile` merges
`skills/apply-settings-profile/profiles/recommended.json` into your user,
project, or local settings. It sets:

- **Fast mode off**: fast mode off, `ultracode` off, and the word "ultracode" in
  a prompt no longer starts a workflow.
- **Lean system prompt**: `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`, Claude Code's
  shorter built-in prompt, about 6.6k fewer tokens on every request.
- **Background usage**: compaction at 200k tokens of context on every plan
  instead of about 967k, and no prompt
  suggestions, automatic session recaps, or idle delivery of cross-session
  messages, since each of those sends a request that re-reads the context.
  The prompt cache TTL is left to Claude Code: a subscription within plan
  usage already gets one hour on the main conversation. On an API key, a
  cloud provider, or usage credits it is five minutes; set
  `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` (Claude Code 2.1.242 or later) if you often
  pause longer, since the API bills 1-hour cache writes at a higher rate.
- **Effort cap**: `maxEffortLevel: "xhigh"`, which also caps agents, skills, and
  workflow stages. `max` is blocked because the claude.ai effort picker warns
  that it uses about 5.5x the usage on Opus 5.5 and 3.5x on Fable 5.1 (as of
  2026-09-26); `xhigh` stays for the rare turn where `high` was not enough.
- **Models**: Opus 5.5 as session and advisor model, Sonnet 5 for built-in
  subagents (`general-purpose` and others that set no model of their own);
  `availableModels` of Opus 5.5, Sonnet 5, Fable 5.1, and Haiku 4.5 (without
  Fable on Pro or a standard Team seat with extra usage off); Fable denied as a
  subagent model. Haiku runs Claude Code's background tasks.
- **Subagent and workflow bounds**: 3 subagents at once, and 3 agents at once in
  a workflow run (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`). Forks are off
  (`CLAUDE_CODE_FORK_SUBAGENT=0`) so subagents run in the foreground and
  return in the turn that spawned them.
  `workflowSizeGuideline: "medium"` asks Claude to aim for fewer than 10 agents
  per workflow; that one is advice, not a cap. Workflows stay on. Since
  2026-09-18, Claude Code also hands every workflow agent your latest chat
  message and tells it that message wins over the script's task
  ([#95369](https://github.com/anthropics/claude-code/issues/95369), open), so
  send nothing unrelated while a workflow launches or runs.
- **Tools**: the task-list tools turned on (off by default on Opus 5.5), and
  the Glob tool skips gitignored files (`CLAUDE_CODE_GLOB_NO_IGNORE=false`), as
  the Grep tool already does.
- **Built-in switches** (`profiles/optional.json`), each applied unless you
  skip it with `--skip name,...`:
  - `artifact`: the Artifact tool (about 34 KB per request).
  - `workflows`: the Workflow tool (5.4 KB).
  - `loops`: the cron tools and `ScheduleWakeup` (4.6 KB).
  - `report-findings`: ReportFindings (2.2 KB), used only by `/code-review`.
  - `advisor`: the advisor tool.
  - `explore-plan`: the Explore and Plan agents.
  - `bundled-skills`: Claude Code's bundled skills.
  - `auto-memory`: auto memory.
  - `refusal-retry`: the automatic retry after a refusal.
  - `auto-updates`: the auto-updater.
- **Feedback off**: `/feedback`, the SendFeedback tool, the session survey, and
  error reports. Telemetry stays on, because turning it off also stops the
  feature-flag fetch that the advisor tool and large-paste marking need.
- **Permissions**:
  - read denies for `.env` files and credential directories;
  - bypass mode disabled.
- **Git**: Claude Code's built-in git instructions replaced by the output
  style's. The session notes keep the commit trailer and pull request footer
  (see `git_attribution` under Options).
- **`$schema`**: the documented settings schema, for editor completion.

The merge only adds, except for the model policy (`availableModels` and
`Agent(model:...)` denies), which it replaces. It can also add a short marked
section to `~/.claude/CLAUDE.md`.

The skill also installs dotclaude's own system prompt, which replaces Claude
Code's built-in one and holds dotclaude's engineering and git rules. The
prompt names the installed Claude Code version. The output style keeps only
how Claude talks and reports, so without the launcher those rules are not
sent. Only the `--system-prompt-file` flag can replace that
prompt, and a plugin cannot pass flags, so the skill adds a `claude` function
to your shell's startup file: `.zshrc`, `.bash_profile` on macOS or `.bashrc`
elsewhere, `conf.d/dotclaude.fish`, or the PowerShell `$PROFILE`. The function
adds nothing when you pass your own `--system-prompt` or
`--system-prompt-file`. `DOTCLAUDE_SYSTEM_PROMPT=0 claude` starts one session
with Claude Code's own prompt. Session start keeps the prompt copy in
`~/.claude/dotclaude/` up to date after each plugin or Claude Code update.
It also tells you when a session starts without the prompt, for example from
an IDE that does not load your shell's function. Set
`DOTCLAUDE_SYSTEM_PROMPT=0` in that environment to silence it. A proxy
wrapper such as `headroom wrap claude` also runs Claude Code without the
function. Run `headroom proxy` instead, export
`ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, and start `claude` as usual. The
replacement does not carry auto memory's instructions, which the profile turns
off. Run `apply-launcher.mjs --remove --apply` to take it out.

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

## Options

Set in `/config` under dotclaude:

- **Guards and gates**, all on by default: `bash_guard`, `edit_guard`,
  `stop_gate`, `compact_carryover`, `subagent_guidance`, `model_lock`,
  and `commit_hygiene`. Turn on `ask_in_auto_mode` to be asked
  about recoverable actions in auto mode as well. The dotclaude agents rely on
  `subagent_guidance` for the shared working-tree rules, the progress log, and
  the report format, so turning it off weakens them. `subagent_guidance` also
  refuses `general-purpose` agents in favor of the dotclaude agent for the job.
- **Git attribution**: `git_attribution`, on by default. The settings profile
  turns off Claude Code's git instructions, and Claude Code then drops its
  `Co-Authored-By` commit trailer and pull request footer. This option adds
  them back through the session notes. Claude Code's `attribution` setting
  still changes or removes them. Turn the option off for no attribution.
- **Model lists**: `allowed_models` lists the Claude models the lock accepts.
- **Claude plan**: `claude_plan` is `auto` by default, which reads the plan
  from Claude Code's cached account; set `pro`, `max_5x`, `max_20x`,
  `team_standard`, `team_premium`, `enterprise`, or `api` to override it.
- **Limits**: `usage_notes` (usage notes and the usage-limit notification)
  and `turn_limit_handoff` (refusing a subagent's tools past 150k tokens of
  context or near its turn limit, and the handoff),
  both on by default.
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
  abstraction from a speculative one, so those live in the system prompt and
  the reviewers.
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
bun scripts/usage-report.mjs --days 7  # where your Claude Code usage went
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
