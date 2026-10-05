# Release 0.11

Release 0.11 moved the subagents to Sonnet 5.5 and tightened the context bounds.
Cost data from 2026-09-28 and 2026-09-29 drove the new bounds.
It requires Claude Code 2.1.284 or later, the first release with Sonnet 5.5.
After updating, run `claude update` if needed, restart Claude Code, and run `/dotclaude:apply-settings-profile` again.
A version in parentheses marks a change from a later patch of this line.
An entry with no version comes from 0.11.0.

## Added

- Session start tells the user when Claude Code is older than 2.1.284.
  It reads `claude --version` of the running binary and says to run `claude update`.

## Changed

- The settings profile compacts at 150k tokens, not 200k.
  The system prompt, the session notes, and the status line use the same handoff point.
  From 2026-09-28 to 2026-09-29, main-conversation calls past 150k were 13% of the cost.
- Claude Code refuses a subagent tool call past 100k tokens of context, not 150k.
  With the 150k bound, 34 of 69 `implementer` runs still passed 100k.
  Subagent calls from 100k to 150k were 9% of the cost.
  `code-reviewer`, `security-reviewer`, and `plan-reviewer` keep 150k, because a split review loses the view across files and writes it to the cache again.
  The injected context budget and the subagent status line row show the bound of each agent.
- The system prompt and the `implementer` description ask for one small slice for each `implementer`.
  Larger work goes to new agents.
- Sonnet 5.5 (`claude-sonnet-5-5`) replaces Sonnet 5 everywhere.
  This covers the `implementer`, `docs-writer`, and `mechanical-worker` agents, the profile's `CLAUDE_CODE_SUBAGENT_MODEL` and `availableModels`, the managed drop-in, and the default `allowed_models`.
  The prices are the same.
  Applying the profile again removes `claude-sonnet-5` from `availableModels`.
  A user who set `allowed_models` must replace `claude-sonnet-5` with `claude-sonnet-5-5`.
- `mechanical-worker` runs at `medium` effort, not `low`.
  Anthropic recalibrated the effort levels of Sonnet 5.5 and gives `medium` as the start for well-specified agentic coding.
  At `low`, the agent sometimes reported a change as done with no check.
- `test-runner` runs on Haiku 4.5, not Sonnet 5 at `low` effort.
  It runs one command and copies the failure lines, which needs no judgment, and Haiku costs half as much per token.
  It starts without `CLAUDE.md` and without the CodeGraph MCP tool, and its report copies each error line exactly.
- The reminder for agents on Sonnet 5.5 (`implementer`, `docs-writer`, and `mechanical-worker`) has more rules (0.11.0, 0.11.1).
  - A real check must come before a report that a code change is done.
    A syntax-only check, or a command that did not start, does not count.
  - The agent writes only in the files that the brief names.
    It puts scratch files in the system temp folder, and it reports defects outside the brief instead of fixing them.
    In one user test of 35 bug-fix tasks, both models fixed 34.
    Sonnet 5.5 wrote outside its assigned folder 4 times and Opus 5.5 0 times.
- The model documentation (`docs/models.md` and the dossier page that is now [Plans and models](Plans-and-Models)) gave this reason (0.11.1).
  0.20.0 removed `docs/models.md`.
  It also gives the reported cost data: Sonnet 5.5 costs less for each task than Opus 5.5 only at `low` and `medium` effort.
  This is why the Sonnet 5.5 agents stay at `medium`.

## Fixed

- The `[unreleased]` compare link at the end of the CHANGELOG starts from the latest release, not 0.8.1 (0.11.1).
  `just bump` now moves it to the new version.

Previous: [Release 0.10](Release-0.10) · Next: [Release 0.12](Release-0.12)
