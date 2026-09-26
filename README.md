# dotclaude

A Claude Code plugin for software engineering with Claude Opus 5.5. Hooks enforce what can be checked mechanically, an always-on output style sets working conventions for what can't, and a set of agents and skills covers review, delegated work, research, and optional Codex workers.

## Install

```text
/plugin marketplace add xsyetopz/dotclaude
/plugin install dotclaude@dotclaude
```

Then run `/dotclaude:apply-settings-profile` and restart Claude Code. A plugin cannot set permissions, environment variables, or models itself, so this step writes them into a settings file you choose, after showing you the changes and making a backup.

Optional integrations (CodeGraph, Headroom, the Codex CLI): ask Claude, for example "set up codegraph for this project", or run `/dotclaude:setup-integrations`.

Requirements: Claude Code 2.1.283 or later, [Bun](https://bun.sh) 1.4.2 or later on `PATH`, and git.

## Update

```bash
claude plugin marketplace update dotclaude   # fetch the latest release list
claude plugin update dotclaude@dotclaude     # install it
```

Then, in order:

1. Restart Claude Code. Hooks, agents, and the output style load at session start, so a running session keeps the old version.
2. Read the new version's entry in [CHANGELOG.md](CHANGELOG.md). Before 1.0, releases may change or remove behavior without a compatibility layer.
3. Run `/dotclaude:apply-settings-profile` again. It previews every change, including any it removes, and backs up the file before writing. A notice at session start tells you when your settings are behind the plugin.
4. If you use the Codex agents, run `/dotclaude:setup-integrations codex` again to refresh the Codex profiles.

`/plugin` inside Claude Code shows the installed version. To try an unreleased checkout instead, run `claude --plugin-dir /path/to/dotclaude`.

## What you get

**Hooks.** Each can be turned off in `/config` under dotclaude.

- **Bash guard**: asks before destructive or public commands (force push, `reset --hard`, publishing, `gh` writes, destructive SQL, `curl | sh`), even when reworded through `sudo`, `env`, `bash -c`, `eval`, `$(...)`, heredocs, or loop bodies. It denies deleting `/` or your home directory.
- **Edit guard**: asks before an edit removes test assertions or adds skip markers to an existing test, and before edits to Claude settings, generated files, or lockfiles.
- **Quiet in auto mode**: recoverable actions (deleting tracked files, `find` deletes, generated-file edits) ask only in attended modes, so an unattended session never waits on a prompt nobody sees. Irreversible and public actions still ask.
- **Verify-before-stop**: sends Claude, or a subagent, back once when it ends after editing code without a test, build, or lint run, or claims tests pass after a failure.
- **Compaction carry-over**: after compaction, restores your last messages verbatim, the last check result, and which uncommitted files this session edited versus everyone else.
- **Model lock**: fast mode stays off. Claude runs on Opus 5.5, Fable 5.1, or Haiku 4.5, and Sonnet is not used. Codex commands may name GPT-6 Luna, Sol, or Astra, and Astra is refused on the ChatGPT Plus plan.

The guards never auto-approve anything and fail open: a bug in dotclaude cannot stop your work. They are a best-effort parser, not a sandbox; for hard isolation use Claude Code's [sandbox](https://code.claude.com/docs/en/sandboxing). When a denied command is really what you want, run it yourself with `! <command>`.

**Output style** (`output-styles/dotclaude.md`). It replaces Claude Code's built-in coding and git instructions, written in the structure of Anthropic's own system prompts. It covers:

- grounded claims, with a sanity check in place of answering from memory;
- challenging an approach before building on it;
- the request as the deliverable;
- sharing the working tree with you;
- debugging by measurement;
- verified, complete reports;
- the stops Claude should and should not make;
- delegation to the agents below.

On Fable 5.1, a session-start note adds that model's adjustments. The style is forced on while the plugin is enabled; to use another, disable the plugin or copy the file to `~/.claude/output-styles/` without `force-for-plugin`.

**Agents.** Claude picks them from their descriptions, or you name one (`dotclaude:<name>`). Each agent's effort is set in its file, because Claude Code ignores an effort passed at spawn time.

| Agent | Model, effort | Use it for |
| --- | --- | --- |
| `code-reviewer`, `security-reviewer`, `plan-reviewer` | Opus 5.5, high | fresh-context review of a change, its security, or a plan |
| `debugger`, `performance-engineer` | Opus 5.5, high | root cause by measurement; measured speed or memory work |
| `implementer`, `test-writer` | Opus 5.5, medium | one well-scoped piece of work; tests in the repository's style |
| `ci-investigator`, `dependency-auditor` | Opus 5.5, medium | why CI failed; dependency health |
| `mechanical-worker`, `docs-writer` | Opus 5.5, low | fully specified bulk edits (in place of Sonnet); docs that match a change |
| `test-runner`, `history-investigator` | Opus 5.5, low | failures without the log noise; why code looks the way it does |
| `web-researcher`, `integration-setup` | Haiku 4.5 | sourced web answers; installing and configuring integrations |
| `codex-worker`, `codex-reviewer` | Haiku 4.5 forwarding to Codex | bounded tasks on GPT-6 Luna; second-opinion review on Astra (Pro plans) or Sol (Plus) |

**Skills.**

| Skill | What it does |
| --- | --- |
| `/dotclaude:apply-settings-profile` | applies the settings profile below |
| `/dotclaude:setup-integrations` | installs and configures CodeGraph, Headroom, and Codex |
| `codex-fanout` | runs a large, well-specified job on parallel Codex Luna workers sized to your ChatGPT plan; Claude reviews and commits |
| `/dotclaude:review-code-changes` | runs `code-reviewer` on the current changes or a range |
| `write-session-handoff` | writes a note a fresh session can continue from |
| `drive-web-browser`, `recognize-captcha` | browser automation with agent-browser or CloakBrowser; offline CAPTCHA OCR as a fallback |
| `/dotclaude:recap` | "where are we and what are we doing?", checked against git; stops for you to confirm |
| `/dotclaude:challenge`, `/dotclaude:blind-spots` | challenges an idea instead of agreeing; infers your goal and what you are not considering |
| `/dotclaude:troubleshoot` | signal-tracing debugging mode, for after a first fix fails |
| `/dotclaude:fresh-eyes`, `/dotclaude:polish` | re-reviews a new doc or change with a fresh reviewer and fixes it; "what would a perfectionist senior dev reject?" |
| `/dotclaude:lessons-learned` | session post-mortem with concrete changes to apply |

Skills shown with a leading `/` are macros you run yourself, and they cost no context until invoked. Claude invokes the others when they fit.

## Settings profile

`/dotclaude:apply-settings-profile` merges `skills/apply-settings-profile/profiles/recommended.json` into your user, project, or local settings. It sets:

- **Fast mode off**: fast mode off and `ultracode` off.
- **Models**: Opus 5.5 as session, subagent, and advisor model; `availableModels` of Opus 5.5, Fable 5.1, and Haiku 4.5. The `sonnet` alias maps to Opus 5.5, and Haiku runs Claude Code's background tasks.
- **Subagent caps**: 6 at once and 40 per session.
- **Tools**: the task-list tools, which are off by default on Opus 5.5.
- **Permissions**:
  - pre-approval for the two Codex profile commands;
  - read denies for `.env` files and credential directories;
  - bypass mode disabled.
- **Git**: Claude Code's built-in git instructions replaced by the output style's.

The merge only adds, except for the model policy (`availableModels` and `Agent(model:...)` denies), which it replaces. It can also add a short marked section to `~/.claude/CLAUDE.md`.

The profile sets no effort level. Opus 5.5 defaults to medium, which suits coding; use `/effort high` for hard debugging and planning. Avoid `max`, and do not set `CLAUDE_CODE_EFFORT_LEVEL`, which overrides every agent's own effort.

## Codex

The Codex agents need the [Codex CLI](https://github.com/openai/codex), logged in with `! codex login`, and the profiles that `/dotclaude:setup-integrations codex` installs into `$CODEX_HOME`:

- **`dotclaude-luna.config.toml`**: a bounded worker on GPT-6 Luna at high effort. It runs in a workspace-write sandbox where `.git` stays read-only, so Claude commits. Subagents, goals, apps, browser use, and the skills catalog are off, which cuts Codex's fixed input from about 32 KB to under 5 KB per request.
- **`dotclaude-review.config.toml`**: a read-only reviewer on Astra for Pro and Pro 5x, and Sol for Plus.
- **`config.toml`**: gets `service_tier = "default"` and fast mode off. On Plus it also gets Luna as the base model. Everything else is kept.

The ChatGPT plan is read from the Codex login token's plan claim; no token leaves the plugin.

## Options

Set in `/config` under dotclaude:

- **Guards and gates**, all on by default: `bash_guard`, `edit_guard`, `stop_gate`, `compact_carryover`, `subagent_guidance`, `model_lock`, `commit_hygiene`, and `codegraph_hint`. Turn on `ask_in_auto_mode` to be asked about recoverable actions in auto mode as well.
- **Model lists**: `allowed_models` lists the Claude models the lock accepts, and `allowed_codex_models` lists the Codex models.
- **CodeGraph**: `codegraph_prompt_context` (off by default) adds CodeGraph context to prompts you type. Use it instead of a global `codegraph prompt-hook`.
- **Browser and CAPTCHA**: `cloakbrowser`, `cloakbrowser_humanize`, `cloakbrowser_headless`, and `captcha_ocr_ddddocr` choose the browser backend and CAPTCHA fallback.

## Design notes

- **No banned-phrase lists.** They get routed around with synonyms, so the conventions name what each behavior does and why.
- **No hooks that judge tone or architecture.** A regex can't tell a needed abstraction from a speculative one, so those live in the output style and the reviewers.
- **No prompt-type or agent-type hooks.** They spend usage on every event.
- **Only documented extension points.** dotclaude uses hooks, output styles, skills, agents, `userConfig`, and settings keys, and never patches Claude Code.

## Development

```bash
bun test tests/                                   # guard rules and hooks end to end
bun run lint && bun run validate                  # biome; claude plugin validate --strict
claude --plugin-dir . plugin details dotclaude    # inventory and token cost
```

Tests pass commands to the guard as strings; nothing in the suite executes a guarded command.

## License

[MIT](LICENSE)
