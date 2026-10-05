# Release 0.1 and 0.2

Release 0.1.0 (2026-09-25) shipped the first guards, gates, and skills.
Release 0.2.0 (2026-09-26) added a team of sixteen agents, Codex integration, and a rewrite of all prompts for Opus 5.5.
It also removed about 150 false-positive permission prompts from auto mode.
Release 0.2 requires Claude Code v2.1.283 or later.
After you update, restart Claude Code and run `/dotclaude:apply-settings-profile` again.

## Added

- Hooks (0.1.0, 2026-09-25):
  - Bash guard
  - edit guard
  - `verify-before-stop` gate
  - compaction carry-over
  - fast-mode and model lock
- The dotclaude output style, forced on while the plugin is enabled (0.1.0).
- The `code-reviewer` agent (0.1.0).
- The skills `apply-settings-profile`, `review-code-changes`, `write-session-handoff`, `drive-web-browser`, and `recognize-captcha` (0.1.0).
- Sixteen agents, each with its effort set in its file (0.2.0, 2026-09-26):
  - Opus 5.5 at high effort: `security-reviewer`, `plan-reviewer`, `debugger`, `performance-engineer`.
  - Opus 5.5 at medium effort: `implementer`, `test-writer`, `ci-investigator`, `dependency-auditor`.
  - Opus 5.5 at low effort: `mechanical-worker` (in place of Sonnet), `test-runner`, `docs-writer`, `history-investigator`.
  - Haiku 4.5: `web-researcher`, `integration-setup`, `codex-worker` (forwards to GPT-6 Luna), `codex-reviewer` (forwards to Astra on Pro plans and Sol on Plus).
- Skills that you run yourself and that cost no context until invoked: `recap`, `challenge`, `blind-spots`, `troubleshoot`, `fresh-eyes`, `polish`, and `lessons-learned`.
- The `setup-integrations` skill checks, installs, and configures CodeGraph, Headroom, and the Codex CLI through the `integration-setup` agent.
  Ask in plain words ("set up headroom") or run `/dotclaude:setup-integrations`.
- Codex profiles, which `/dotclaude:setup-integrations codex` installs as `$CODEX_HOME/<name>.config.toml` files that inherit `config.toml`:
  - `dotclaude-luna`: a bounded worker on GPT-6 Luna at high effort.
    It has a workspace-write sandbox and no approvals.
    Subagents, goals, apps, browser use, and the skills catalog are off.
  - `dotclaude-review`: a read-only reviewer on Astra for Pro plans and Sol for Plus.
- The Codex setup also sets `service_tier = "default"` and fast mode off in `config.toml`.
  On Plus, it pins the base model to Luna.
- The `codex-fanout` skill runs a large, well-specified job as a queue of small items on parallel Luna workers.
  The number of workers fits the ChatGPT plan.
  Claude reviews and commits the results.
- The Codex plan (`plus`, `prolite`, `pro`) comes from the `chatgpt_plan_type` claim of the Codex login.
  Tokens never leave the helper.
- A stop gate on `SubagentStop`, checked against the subagent's own edits and check runs.
- Files written through Bash now count as edits:
  - redirects, `tee`, `sed -i`, `perl -i`, and `sd`
  - `mv` and `cp` targets
  - interpreter code that writes a file it names inside the project
- Compaction carry-over lists uncommitted files in two groups.
  The first group holds files that this session or its subagents edited.
  The second group holds the other files.
  They may belong to the user, so Claude must not revert them.
- Session-start notes:
  - Fable 5.1's adjustments to the Opus-tuned output style, on Fable sessions only.
  - Non-default browser and CAPTCHA options, because plugin options cannot pass to skills directly.
  - A notice when the settings profile is out of date or `CLAUDE_CODE_EFFORT_LEVEL` is set.
- Options:
  - `ask_in_auto_mode`: ask about recoverable actions even in auto mode.
  - `allowed_codex_models`: the Codex models that a `codex` command may name.
  - `codegraph_prompt_context`: run `codegraph prompt-hook` for prompts you type.
    It skips background-task notifications and subagent hand-backs.
- Settings profile additions:
  - Haiku 4.5 in `availableModels`, and as `ANTHROPIC_DEFAULT_HAIKU_MODEL` for background tasks.
  - The `sonnet` alias mapped to Opus 5.5.
  - `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, because the task-list tools are off by default on Opus 5.5.
  - `ultracode: false`.
  - Pre-approval for `codex exec -p dotclaude-luna *` and `codex exec -p dotclaude-review *`.
- Read-only agents can call `mcp__codegraph__codegraph_explore` and `mcp__headroom__headroom_retrieve`.
- The CloakBrowser launcher accepts `--no-humanize` and `--no-geoip`.

## Changed

- Recoverable actions ask only in attended permission modes.
  In auto mode, the auto mode classifier decides them.
  These actions are:
  - removing git-tracked files
  - `find` and `fd` removes
  - inline code that removes files
  - edits of generated files and lockfiles
  - a Write that drops most of a long file
- The output style, every agent, the injected subagent guidance, and the skills use Anthropic's prompting structure for Opus 5.5.
  This structure has XML-wrapped prose sections, a reason for each rule, calm wording, and a closing `<tone_preference>`.
- New output-style rules:
  - a sanity check instead of an answer from memory
  - debugging by measurement
  - challenging a proposed approach before building on it
  - a shared working tree with the user
  - use of credentials that the user points to, without printing them
  - a new check of state after compaction
  - a true task list
  - a small main context, without self-verification subagents
- Narration follows a cadence instead of a ban on text between tool calls.
  Claude writes one line before the first tool call.
  After that, it writes updates only for findings, blockers, and changes of direction.
- Reviewers report every finding with a severity and a confidence.
  Use them for requested changes and for large, risky changes.
- Agents that edit never stash, check out, restore, reset, or bisect in the shared tree.
- Model policy:
  - Haiku 4.5 is allowed by default.
  - An explicit Sonnet model is denied, with a pointer to `mechanical-worker`.
  - The cap on concurrent subagents rises from 4 to 6.
- The settings profile replaces the model policy instead of a merge.
  This covers `availableModels` and any `Agent(model:...)` deny that the profile does not carry.
- `drive-web-browser` has a `when_to_use` trigger.
  The global CLAUDE.md section no longer lists browser CLIs.
  It adds the credential rule and the sanity-check rule.
- Bash guard `mktemp` handling: `S=$(mktemp -d)` with no directory argument resolves as a temp path.

## Removed

- The `Agent(model:sonnet*)`, `Agent(model:haiku*)`, and `Agent(model:claude-haiku*)` denies from the settings profile.
- The blanket "write nothing between tool calls" instruction for subagents.

## Fixed

- About 150 of the 188 prompts that real auto-mode sessions recorded were false positives:
  - `S=/tmp/x; rm -rf $S` now resolves `$S` when the script assigns it once to a literal value.
    Reassignment, `read`, `unset`, `for`, `eval`, `IFS`, and values with whitespace keep it unresolved.
  - Cache cleanups through `find` or `fd` (`__pycache__`, `*.pyc`, and similar) no longer ask.
    This applies only when the match itself is the only thing that the command removes.
  - `env -u X swift test` inside a loop is no longer a snapshot update.
  - `gh … --help` is no longer a GitHub write.
  - `git worktree remove --force` asks only when the worktree has uncommitted changes.
  - Skip markers in a new test file no longer count as weakening tests.
- The CloakBrowser launcher crashed on `--no-humanize` and `--no-geoip`.
- The `cloakbrowser`, `cloakbrowser_headless`, `cloakbrowser_humanize`, and `captcha_ocr_ddddocr` options had no effect.
- `drive-web-browser` referred to a `browser_backend` option that does not exist.

## Security

- The Bash guard did not check commands after shell keywords (`if …; then rm -rf /; fi`, `do`, `else`, `while`).
  It checks them now.
- `codex` commands:
  - `--dangerously-bypass-*` flags are denied.
  - A change that turns Codex fast mode or the priority tier on again is denied.
  - Models outside `allowed_codex_models` are denied.
  - GPT-6 Astra is refused on the ChatGPT Plus plan.
    This applies when `-m`, a `-p` profile, or the base config sets it.

Next: [Release 0.3](Release-0.3)
