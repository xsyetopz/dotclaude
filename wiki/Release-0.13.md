# Release 0.13

Released 2026-09-29.
One hook process runs for each event, the `run-agent-loop` skill runs large changes as slices, and the browser skills moved to a separate plugin.
Two upgrades need action: `brew install betterleaks` and `/plugin install dotclaude-browser@dotclaude`.
A version in parentheses marks a later patch of this line, and an entry with no version comes from 0.13.0.

## Added

- `run-agent-loop` skill: runs a large change as slices, the workflow of the Bun, GitHub Copilot, and pnpm v12 Rust ports.
  The main conversation writes `.dotclaude/loop/GUIDE.md` and `slices.jsonl`.
  Each slice goes to an `implementer` in a worktree, then to `diff-reviewer`, then to a fixer, and then to the frozen tests.
  A wave runs at most 5 slices at the same time.
  - `diff-reviewer` agent (Sonnet 5.5, medium effort, read-only): reviews one slice from its diff and `GUIDE.md` only, not from the report of the implementer.
  - Protected files: while `.dotclaude/loop/loop.json` lists `protected` globs, the edit and Bash guards deny a subagent change to a matching file and its removal.
    The main conversation has no limit.
  - Stop hook: sends Claude back once when a loop slice has the status `implemented` and no review.
  - Status line: shows the loop progress, for example `loop 2/7`.
- Bash guard, file follows: denies `tail -f`, `tail -F`, and `inotifywait -m` also in the background, unless `timeout` bounds it.
  A background follow ran until the session ended, also after its file was removed.
  The reason names an `until grep -q` loop and `Monitor`.
- Bash guard, background stdin: denies a background command that reads stdin to its end before it starts work, when the command has no stdin of its own.
  - The commands are `codex exec`, `cat` and `python`, `python3`, or `node` with no file, `tr`, and a shell with no script.
  - A background call usually gets `/dev/null` as stdin.
    In one session it got a pipe that did not close, and two `codex exec … &` runs waited on it for 81 minutes.
  - A `</dev/null` or `0<` redirect, a heredoc, a pipe, or `exec </dev/null` lets the command through.
- Prompt tags: the agent and skill prompts use one set of XML tags in one order.
  The order is `<task>` (skills) or a role paragraph (agents), `<context>`, `<inputs>`, `<constraints>`, `<procedure>`, topic sections, `<report_format>` (agents) or `<output_format>` (skills), then `<example>`.
  The prompting guide of Anthropic asks for consistent, descriptive tag names, and gives no fixed set.

## Changed

- Hook processes: `hooks/dispatch.mjs` runs all actions of an event in one `bun` process, at the same time, and merges their output.
  A `Bash` call starts 2 hook processes instead of 7, and uses about half the CPU time (164 ms to 86 ms, measured).
  An error in one action does not stop the others.
- Skill descriptions: shorter, because Claude Code lists them in every main turn.
  - Each is now 150 to 230 characters, from 190 to 540.
  - `drive-web-browser` has no `when_to_use` now, because its description holds the trigger.
  - A new limit in `LIMITS` fails the tests above 250 characters.
- Bash guard, ignored directories: denies a walk into a gitignored directory only when that directory has 200 entries or more.
  Small caches such as `__pycache__` or `xcuserdata` no longer cause a deny.
  In the 6 days to 2026-09-29, this rule denied 85 commands, and the usual false deny was `grep -rn X Sources Tests` over a small cache.
- Secret redaction: uses [Betterleaks](https://github.com/betterleaks/betterleaks) instead of gitleaks.
  - It takes the same rules and the same `GITLEAKS_CONFIG`, and also reads `BETTERLEAKS_CONFIG`.
    Live validation stays off.
  - **Upgrade:** run `brew install betterleaks`.
    Until then, tool output is not redacted, and session start says so.
  - dotclaude does not use gitleaks any more.
    Keep it for pre-commit hooks.
- Stop gate: no longer blocks a pass claim when nothing was edited and nothing ran.
  It blocked read-only research agents that reported results that others ran.
  After a failed check, a claim in backticks, a code block, or a `>` line does not count as a pass claim.
- Open-task and announced-work checks: let a turn through when it ends with `ExitPlanMode`.
  The open-task check also lets a turn through when it ends with `AskUserQuestion`, and it does not apply to subagents.
- Task-completion gate: no longer writes `task` lines to `verdicts.jsonl`.
  The input check from 0.12.0 is closed.
- `Agent(general-purpose)` deny (0.13.0, 0.13.1): the settings profile denies it.
  - The deny removes the agent from the list that Claude sees (checked with `claude -p`).
  - In one week, Claude asked for it 244 times, and the hook of the plugin refused each call.
    The hook stays for sessions without the profile.
  - The user runs `/dotclaude:apply-settings-profile` again to add the deny.
    The skill lists the deny in its group table, so the user sees the reason before applying.
  - The Models row no longer names `general-purpose` as an agent on Sonnet 5.5.
- Usage report: counts the wake turns of each entrypoint.
  In the week to 2026-09-29, 527 of 532 wake turns were in `cli` sessions.
  280 were messages from other sessions, and 125 of the 128 agent wakes were before 0.7.0 kept agents in the foreground.
- Browser plugin: browser automation and CAPTCHA OCR moved to the optional `dotclaude-browser` plugin in the same marketplace.
  - Sessions without it do not load the two skills or their session note.
    The session note of the plugin also replaces the browser line in the `CLAUDE.md` block of the settings profile.
  - **Upgrade:** run `/plugin install dotclaude-browser@dotclaude`.
    Then set `cloakbrowser`, `cloakbrowser_humanize`, `cloakbrowser_headless`, and `captcha_ocr_ddddocr` again in `/config` under dotclaude-browser.
    The old values under dotclaude have no effect.
  - `/dotclaude:setup-integrations` shows whether the plugin, agent-browser, CloakBrowser, and ddddocr are installed.
- Context and usage notes: ask for a handoff note with the `write-session-handoff` skill and then `/clear`, not `/compact`.
  A handoff keeps the facts that Claude chooses, and `/compact` costs a full turn over the large context.
  The system prompt of the settings profile says the same.
- Output style: has a ceiling of 900 tokens (warn at 700), not 2000, and measures 515 tokens.
- `integration-setup`: tells the agent to trust `--help` over memory.
  Haiku 4.5 has reliable knowledge only to Feb 2025, and the tools that it sets up are newer.
  A new test fails when an agent on Haiku 4.5 sets `effort`, because Haiku 4.5 does not support it and `claude plugin validate` accepts it.

## Removed

- Three usage notes that did not fire in the transcripts from 2026-09-25 to 2026-09-29.
  They are the third-correction and refusal notes (`note-rewind`, 0 fires), the repeated-command note (`note-repeated-status`, 0 fires), and the expired-cache notice (`note-stale-cache`, 1 fire).
  The status line shows the cache expiry, and the follow guard and `Monitor` cover polling.

## Fixed

- Task-completion gate: named no task, because it read `task_name` and `task_status`, which Claude Code does not send.
  It now reads `task_id` and `task_subject`, and the reason names the task.
- Docs: the README, the settings profile doc, and the design doc said that 3 subagents run at the same time.
  The limit is 5, as `_budget.mjs` sets.

Previous: [Release 0.12](Release-0.12) · Next: [Release 0.14](Release-0.14)
