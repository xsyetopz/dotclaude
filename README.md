# dotclaude

dotclaude is a Claude Code plugin for software engineering with Claude Opus
5.5. Hooks enforce the rules that a program can check. A replacement system
prompt and an output style set the other working rules. Agents and skills do
review, delegated work, and research.

[`docs/dossier.md`](docs/dossier.md) records the design decisions and the
measurements behind them.

## Install

```text
/plugin marketplace add xsyetopz/dotclaude
/plugin install dotclaude@dotclaude
```

Then run `/dotclaude:apply-settings-profile` and restart Claude Code. A plugin
cannot set permissions, environment variables, or models. This skill writes
them into a settings file that you choose. It shows the changes and makes a
backup first.

For the optional integrations (CodeGraph, tgrep, Headroom, fast-compact), run
`/dotclaude:setup-integrations`, or ask Claude, for example "set up codegraph
for this project".

Requirements: Claude Code 2.1.283 or later, [Bun](https://bun.sh) 1.4.2 or
later on `PATH`, and git.

## Update

```bash
claude plugin marketplace update dotclaude
claude plugin update dotclaude@dotclaude
```

1. Restart Claude Code. A running session keeps the old hooks, agents, and
   output style.
1. Read the new entry in [`CHANGELOG.md`](CHANGELOG.md). Before 1.0, a release
   can change or remove behavior without a compatibility layer.
1. Run `/dotclaude:apply-settings-profile` again. It shows every change and
   backs up the file. A notice at session start tells you when your settings
   are behind the plugin.

To try an unreleased checkout, run `claude --plugin-dir /path/to/dotclaude`.

## Hooks

You can turn off each hook in `/config` under dotclaude.

- **Bash guard:** asks before destructive or public commands, such as force
  push, `reset --hard`, publishing, `gh` writes, destructive SQL, and
  `curl | sh`. It also finds them inside `sudo`, `env`, `bash -c`, `eval`,
  `$(...)`, heredocs, and loops. It denies deletion of `/` or your home
  directory. It denies recursive searches that walk gitignored build output or
  dependencies (`grep -r`, `find`, `tree`, `rg --no-ignore`, `fd -I`). Plain
  `rg`, `fd`, and `git grep` skip those directories.
- **Edit guard:** asks before an edit removes test assertions or skips an
  existing test. It also asks before edits to Claude settings, generated
  files, or lockfiles.
- **Quiet in auto mode:** recoverable actions ask only in attended modes, so
  an unattended session never waits on a prompt. Irreversible and public
  actions still ask.
- **Verify-before-stop:** sends Claude back once when it edits code and stops
  without a test, build, or lint run. It does the same when Claude claims that
  tests pass after a failure.
- **Compaction carry-over:** after compaction, restores your last messages
  word for word, the last check result, and the files this session edited.
- **Model lock:** keeps fast mode off and limits Claude to Opus 5.5, Sonnet 5,
  Fable 5.1, and Haiku 4.5. Fable is never a subagent model. On Pro, or on a
  standard Team seat without extra usage, the lock leaves Fable out, because
  those plans pay for it with usage credits.
- **Plan awareness:** reads your Claude plan and tells Claude at session start
  what the plan means for model choice.
- **Usage bounds:** refuses a subagent's tool calls past 150k tokens of
  context or near its turn limit, so its next action is its report. The work
  continues in a fresh agent. Claude cannot spawn `general-purpose` agents,
  and subagents run in the foreground.
- **Usage notes:** tells Claude once when the session or weekly limit passes
  75% and 90%. When a turn stops on a usage limit, a terminal notification
  names the limit, its reset time, and the `claude --resume` command.
- **Stalled goals:** ends the turn and pauses a `/goal` when its check blocks
  a stop twice in a row with no work between.
- **Instruction-file lint:** at session start, reports `CLAUDE.md`,
  `AGENTS.md`, and rule files that pass 150 lines (warning) or 200 lines
  (failure). It also reports startup instructions above about 3,000 tokens
  together, and broken imports or symlinks.

Every dotclaude message starts with `[dotclaude]`. The guards never approve
anything, and they fail open. They are a best-effort parser, not a sandbox.
For hard isolation, use Claude Code's
[sandbox](https://code.claude.com/docs/en/sandboxing). To run a command that a
guard denied, type `! <command>`.

## Output Style

`output-styles/dotclaude.md` sets how Claude talks and reports. It is always
on while the plugin is on. To use a different style, disable the plugin,
or copy the file to `~/.claude/output-styles/` without `force-for-plugin`.

On Fable 5.1, a session note adds that model's adjustments. Every dotclaude
agent learns its turn limit at start. Agents on Sonnet 5 get a reminder to
apply each instruction to everything it covers.

## Agents

Claude picks an agent from its description, or you name one
(`dotclaude:<name>`). Each agent file sets its effort, because Claude Code
ignores an effort passed at spawn time.

| Agent | Model, effort | Use |
| --- | --- | --- |
| `code-reviewer`, `security-reviewer`, `plan-reviewer` | Opus 5.5, high | fresh-context review of a change, its security, or a plan |
| `debugger`, `performance-engineer` | Opus 5.5, high | root cause by measurement, speed or memory work |
| `implementer` | Sonnet 5, medium | one well-scoped piece of work (`model: "opus"` for design judgment) |
| `test-writer` | Opus 5.5, medium | tests in the repository's style |
| `ci-investigator`, `dependency-auditor` | Opus 5.5, medium | CI failures, dependency health |
| `mechanical-worker`, `test-runner` | Sonnet 5, low | fully specified bulk edits, test failures without log noise |
| `docs-writer` | Sonnet 5, medium | docs that match a change |
| `history-investigator` | Opus 5.5, low | why code looks the way it does |
| `web-researcher` | Opus 5.5, low | web answers with sources, read from raw pages |
| `integration-setup` | Haiku 4.5 | integration install and setup |

## Skills

| Skill | Use |
| --- | --- |
| `/dotclaude:apply-settings-profile` | applies the settings profile |
| `/dotclaude:setup-integrations` | installs and configures CodeGraph, tgrep, Headroom, and fast-compact |
| `write-session-handoff` | writes a note that a fresh session can continue from |
| `drive-web-browser`, `recognize-captcha` | browser automation with agent-browser or CloakBrowser, offline CAPTCHA OCR |

You name the skills with a leading `/`. You can put `/dotclaude:<skill>`
anywhere in a message. A user-only skill must start the message. General
workflow skills are in [xsyetopz/skills](https://github.com/xsyetopz/skills).

## Settings Profile

`/dotclaude:apply-settings-profile` merges
`skills/apply-settings-profile/profiles/recommended.json` into your user,
project, or local settings. The merge only adds keys. It replaces only the
model policy (`availableModels` and the `Agent(model:...)` denies).

- **Models:** Opus 5.5 for the session and the advisor, Sonnet 5 for
  built-in subagents, and Haiku 4.5 for background tasks. The profile denies
  Fable as a subagent model. Fast mode and `ultracode` are off.
- **Effort:** `maxEffortLevel: "xhigh"` blocks `max`. Opus 5.5 defaults to
  medium. Use `/effort high` for hard debugging and planning. Do not set
  `CLAUDE_CODE_EFFORT_LEVEL`, because it overrides every agent's effort.
- **Context:** compaction at 200k tokens on every plan. The profile turns off
  prompt suggestions, automatic recaps, and idle message delivery, because
  each of them re-reads the context.
- **Prompt cache:** Claude Code sets the TTL. On an API key or usage credits
  it is five minutes. Set `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` if you often pause
  longer.
- **Fan-out:** 3 subagents at once, and 3 agents at once in a workflow. Forks
  are off, so subagents run in the foreground. Claude Code gives every
  workflow agent your latest chat message
  ([#95369](https://github.com/anthropics/claude-code/issues/95369)), so send
  nothing unrelated while a workflow runs.
- **Prompt and tools:** the lean built-in prompt
  (`CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`), the task-list tools on, and Glob
  without gitignored files (`CLAUDE_CODE_GLOB_NO_IGNORE=false`).
- **Optional switches** (`profiles/optional.json`): each one turns off a
  built-in feature. Skip one with `--skip name,...`. The switches are
  `artifact`, `workflows`, `loops`, `report-findings`, `advisor`,
  `explore-plan`, `bundled-skills`, `auto-memory`, `refusal-retry`, and
  `auto-updates`.
- **Feedback:** `/feedback`, the feedback tool, surveys, and error reports are
  off. Telemetry stays on, because the advisor tool needs its feature flags.
- **Permissions:** read denies for `.env` files and credential directories.
  Bypass mode is off.
- **Git:** the system prompt replaces Claude Code's git instructions. The
  `git_attribution` option keeps the commit trailer and pull request footer.

### System Prompt Launcher

Only the `--system-prompt-file` flag replaces Claude Code's system prompt, and
a plugin cannot pass flags. The skill therefore adds a `claude` function to
your shell's startup file (zsh, bash, fish, or PowerShell). The function
passes dotclaude's system prompt, which holds its engineering and git rules.

- The function adds nothing when you pass your own `--system-prompt` or
  `--system-prompt-file`.
- `DOTCLAUDE_SYSTEM_PROMPT=0 claude` starts one session with Claude Code's own
  prompt. Set the same variable to silence the session-start notice in an IDE
  that does not load your shell function.
- A wrapper such as `headroom wrap claude` skips the function. Run
  `headroom proxy`, export `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, and
  start `claude` as usual.
- `apply-launcher.mjs --remove --apply` removes the function.

### Managed Lock

You can remove the effort cap from your own settings. To lock it, run the
skill's `install-managed.mjs` with `sudo` in your own terminal. It writes
`managed-settings.d/50-dotclaude.json` with the effort cap, fast mode off, and
the model list. It never changes an existing `managed-settings.json`, and it
asks before it replaces a different drop-in.

## Options

Set these in `/config` under dotclaude.

| Option | Default | Effect |
| --- | --- | --- |
| `bash_guard`, `edit_guard`, `stop_gate`, `goal_loop_guard`, `compact_carryover`, `model_lock`, `commit_hygiene` | on | the hooks above |
| `subagent_guidance` | on | shared rules and report format for agents, and the `general-purpose` refusal |
| `ask_in_auto_mode` | off | asks about recoverable actions in auto mode too |
| `git_attribution` | on | adds the `Co-Authored-By` trailer and pull request footer |
| `allowed_models` | the four models | the models that the lock accepts |
| `claude_plan` | `auto` | `pro`, `max_5x`, `max_20x`, `team_standard`, `team_premium`, `enterprise`, or `api` |
| `usage_notes`, `turn_limit_handoff` | on | usage notes, and the subagent context and turn bounds |
| `scratchpad_prune_days` | `0` (off) | removes idle Claude Code scratchpads older than this many days |
| `cloakbrowser`, `cloakbrowser_humanize`, `cloakbrowser_headless`, `captcha_ocr_ddddocr` | agent-browser, no OCR | browser backend and CAPTCHA fallback |

## Development

```bash
just test                    # bun test ./tests/
just lint                    # biome lint
just validate                # claude plugin validate --strict
just check                   # all three
just bump minor --dry-run    # preview a version bump
claude --plugin-dir . plugin details dotclaude  # inventory and token cost
bun scripts/usage-report.mjs --days 7  # where your usage went
```

`just bump` sets one version in `.claude-plugin/plugin.json` and
`package.json`, and it moves the `[Unreleased]` CHANGELOG entries under a
dated heading. CI runs `biome ci` and the tests on Linux and macOS.

The behavior evals run with `claude plugin eval`. `evals/` tests dotclaude's
own rules. `evals-heldout/` has cases written without access to dotclaude's
prompts. `bun evals/report.mjs <result.json>` reports the results with 95%
intervals. The tests pass commands to the guard as strings and never run a
guarded command.

## License

[MIT](LICENSE)
