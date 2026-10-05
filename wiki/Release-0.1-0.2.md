# Release 0.1 and 0.2

Released 2026-09-25 (0.1.0) and 2026-09-26 (0.2.0).
0.1.0 ships the first guards, gates, and skills.
0.2.0 adds a team of sixteen agents, Codex integration, and a rewrite of all prompts for Opus 5.5.
It also removes about 150 false-positive permission prompts from auto mode.
This line requires Claude Code v2.1.283 or later.
After you update, restart Claude Code and run `/dotclaude:apply-settings-profile` again.

## Added

- Hooks (0.1.0): the Bash guard, the edit guard, the `verify-before-stop` gate, compaction carry-over, and the fast-mode and model lock.
- Output style (0.1.0): the dotclaude output style, forced on while the plugin is enabled.
- `code-reviewer` agent (0.1.0).
- Skills (0.1.0): `apply-settings-profile`, `review-code-changes`, `write-session-handoff`, `drive-web-browser`, and `recognize-captcha`.
- Sixteen agents (0.2.0), each with its effort set in its file:

  | Model and effort | Agents |
  | --- | --- |
  | Opus 5.5, high | `security-reviewer`, `plan-reviewer`, `debugger`, `performance-engineer` |
  | Opus 5.5, medium | `implementer`, `test-writer`, `ci-investigator`, `dependency-auditor` |
  | Opus 5.5, low | `mechanical-worker` (in place of Sonnet), `test-runner`, `docs-writer`, `history-investigator` |
  | Haiku 4.5 | `web-researcher`, `integration-setup`, `codex-worker` (forwards to GPT-6 Luna), `codex-reviewer` (forwards to Astra on Pro plans and Sol on Plus) |

- Self-run skills: `recap`, `challenge`, `blind-spots`, `troubleshoot`, `fresh-eyes`, `polish`, and `lessons-learned`.
  They cost no context until invoked.
- `setup-integrations` skill: checks, installs, and configures CodeGraph, Headroom, and the Codex CLI through the `integration-setup` agent.
  Ask in plain words ("set up headroom") or run `/dotclaude:setup-integrations`.
- Codex profiles: `/dotclaude:setup-integrations codex` installs them as `$CODEX_HOME/<name>.config.toml` files that inherit `config.toml`.
  - `dotclaude-luna`: a bounded worker on GPT-6 Luna at high effort.
    It has a workspace-write sandbox and no approvals.
    Subagents, goals, apps, browser use, and the skills catalog are off.
  - `dotclaude-review`: a read-only reviewer on Astra for Pro plans and Sol for Plus.
  - The setup also sets `service_tier = "default"` and fast mode off in `config.toml`.
    On Plus, it pins the base model to Luna.
- `codex-fanout` skill: runs a large, well-specified job as a queue of small items on parallel Luna workers.
  The number of workers fits the ChatGPT plan, and Claude reviews and commits the results.
- Codex plan detection: the Codex plan (`plus`, `prolite`, `pro`) comes from the `chatgpt_plan_type` claim of the Codex login.
  Tokens never leave the helper.
- Subagent stop gate: a stop gate on `SubagentStop`, checked against the subagent's own edits and check runs.
- Bash writes as edits: files written through Bash now count as edits.
  - redirects, `tee`, `sed -i`, `perl -i`, and `sd`
  - `mv` and `cp` targets
  - interpreter code that writes a file it names inside the project
- Compaction carry-over: lists uncommitted files in two groups.
  The first group holds files that this session or its subagents edited.
  The second group holds the other files, which may belong to the user, so Claude must not revert them.
- Session-start notes:
  - Fable 5.1's adjustments to the Opus-tuned output style, on Fable sessions only.
  - Non-default browser and CAPTCHA options, because plugin options cannot pass to skills directly.
  - A notice when the settings profile is out of date or `CLAUDE_CODE_EFFORT_LEVEL` is set.
- Options:
  - `ask_in_auto_mode`: ask about recoverable actions even in auto mode.
  - `allowed_codex_models`: the Codex models that a `codex` command may name.
  - `codegraph_prompt_context`: run `codegraph prompt-hook` for prompts you type, and skip background-task notifications and subagent hand-backs.
- Settings profile:
  - Haiku 4.5 in `availableModels`, and as `ANTHROPIC_DEFAULT_HAIKU_MODEL` for background tasks.
  - The `sonnet` alias mapped to Opus 5.5.
  - `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, because the task-list tools are off by default on Opus 5.5.
  - `ultracode: false`.
  - Pre-approval for `codex exec -p dotclaude-luna *` and `codex exec -p dotclaude-review *`.
- Read-only agents: can call `mcp__codegraph__codegraph_explore` and `mcp__headroom__headroom_retrieve`.
- CloakBrowser launcher: accepts `--no-humanize` and `--no-geoip`.

## Changed

- Recoverable actions: they ask only in attended permission modes.
  In auto mode, the auto mode classifier decides them.
  - removing git-tracked files
  - `find` and `fd` removes
  - inline code that removes files
  - edits of generated files and lockfiles
  - a Write that drops most of a long file
- Prompt structure: the output style, every agent, the injected subagent guidance, and the skills use Anthropic's prompting structure for Opus 5.5.
  It has XML-wrapped prose sections, a reason for each rule, calm wording, and a closing `<tone_preference>`.
- New output-style rules:
  - a sanity check instead of an answer from memory
  - debugging by measurement
  - challenging a proposed approach before building on it
  - a shared working tree with the user
  - use of credentials that the user points to, without printing them
  - a new check of state after compaction
  - a true task list
  - a small main context, without self-verification subagents
- Narration: follows a cadence instead of a ban on text between tool calls.
  Claude writes one line before the first tool call, and after that only updates for findings, blockers, and changes of direction.
- Reviewers: report every finding with a severity and a confidence.
  Use them for requested changes and for large, risky changes.
- Editing agents: never stash, check out, restore, reset, or bisect in the shared tree.
- Model policy:
  - Haiku 4.5 is allowed by default.
  - An explicit Sonnet model is denied, with a pointer to `mechanical-worker`.
  - The cap on concurrent subagents rises from 4 to 6.
- Settings profile: replaces the model policy instead of a merge.
  This covers `availableModels` and any `Agent(model:...)` deny that the profile does not carry.
- `drive-web-browser`: has a `when_to_use` trigger.
  The global CLAUDE.md section no longer lists browser CLIs, and it adds the credential rule and the sanity-check rule.
- Bash guard `mktemp`: `S=$(mktemp -d)` with no directory argument resolves as a temp path.

## Removed

- Model denies: the `Agent(model:sonnet*)`, `Agent(model:haiku*)`, and `Agent(model:claude-haiku*)` denies from the settings profile.
- Silence rule: the blanket "write nothing between tool calls" instruction for subagents.

## Fixed

- False positives in auto mode: about 150 of the 188 prompts that real auto-mode sessions recorded.
  - `S=/tmp/x; rm -rf $S` now resolves `$S` when the script assigns it once to a literal value.
    Reassignment, `read`, `unset`, `for`, `eval`, `IFS`, and values with whitespace keep it unresolved.
  - Cache cleanups through `find` or `fd` (`__pycache__`, `*.pyc`, and similar) no longer ask.
    This applies only when the match itself is the only thing that the command removes.
  - `env -u X swift test` inside a loop is no longer a snapshot update.
  - `gh … --help` is no longer a GitHub write.
  - `git worktree remove --force` asks only when the worktree has uncommitted changes.
  - Skip markers in a new test file no longer count as weakening tests.
- CloakBrowser launcher: it crashed on `--no-humanize` and `--no-geoip`.
- Browser options: `cloakbrowser`, `cloakbrowser_headless`, `cloakbrowser_humanize`, and `captcha_ocr_ddddocr` had no effect.
- `drive-web-browser`: it referred to a `browser_backend` option that does not exist.

## Security

- Bash guard: it did not check commands after shell keywords (`if …; then rm -rf /; fi`, `do`, `else`, `while`).
  It checks them now.
- `codex` commands:
  - `--dangerously-bypass-*` flags are denied.
  - A change that turns Codex fast mode or the priority tier on again is denied.
  - Models outside `allowed_codex_models` are denied.
  - GPT-6 Astra is refused on the ChatGPT Plus plan, when `-m`, a `-p` profile, or the base config sets it.

Next: [Release 0.3](Release-0.3)
