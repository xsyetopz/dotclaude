# Release 0.4

Release 0.4.0 (2026-09-26) made Claude reproduce a bug before it fixes the bug.
It also cut prompt size, turned off feedback features, and added a held-out eval suite with statistics.
Release 0.4 requires Claude Code v2.1.283 or later.
After you update:

1. Restart Claude Code.
1. Run `/dotclaude:apply-settings-profile` again for the feedback settings, the `AskUserQuestion` deny, and the new global `CLAUDE.md` block.
1. If you use the Codex agents, run `/dotclaude:setup-integrations codex` again.

[Evals](Evals) reports what the eval suites show for this release, and what they do not show.

## Added

- The settings profile turns feedback off with `DISABLE_FEEDBACK_COMMAND`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`, and `DISABLE_ERROR_REPORTING`.
  This removes the SendFeedback tool from every request.
  Telemetry stays on.
  Turning it off also stops the feature-flag request that the advisor tool and large-paste marking need.
- The settings profile denies `AskUserQuestion`, which costs about 4.9 KB per request.
- Reproduce before fixing.
  The output style and the SubagentStart conventions treat a reported bug as unconfirmed until a minimal reproducible example (MRE) shows it.
  They treat any cause that the report names the same way.
  - The report holds the MRE and its output.
  - Claude answers a report that does not reproduce with the MRE that it tried and no code change.
  - When the MRE shows a different cause, Claude fixes the proven cause and says that the named cause was wrong.
- Proven bugs get fixed.
  Claude fixes a real bug that it finds along the way and proves with an MRE, with a minimal change, even if nobody asked.
  It reports the bug separately with its MRE.
  - Claude reports a large fix, or a fix that changes behavior that callers may rely on, instead of making it.
  - Unreproduced suspicions, cleanups, and performance concerns stay follow-ups.
  - This applies to questions too.
    When the answer to "why does this fail?" proves a bug, Claude fixes it without a request.
- Code items go in single backticks, in replies and in dotclaude's own prompts.
  Code items are identifiers, paths, commands, flags, environment variables, config keys, and values.
- Eval cases for the output style, agent routing, and subagent dispatch: `blunt-message`, `question-confirmed-bug`, `scope-follow-up`, `commit-own-files`, `finish-without-offer`, `check-flag`, `review-routing`, `surgical-edit`, `delegated-report`, `false-alarm`, and `missing-peer-dependency`.
  The bug-fix cases also check that the failure reproduced before the first edit.
- `evals-heldout/`: 30 cases that `claude -p --safe-mode` sessions wrote.
  The sessions saw only the failure dossiers and Reddit exports, never dotclaude's prompts.
  A commit froze the cases before any agent ran against them.
  About a third are cases where caution is the wrong answer.
  Its README states when a case may change.
- `evals/report.mjs` summarizes a `claude plugin eval --json` result.
  It follows Anthropic's statistical guidance for evals and reports:
  - trials passed per case, with 95% Wilson intervals
  - pass^k
  - a suite mean, with standard errors clustered by case
  - the paired difference with and without the plugin
- `docs/evals.md`: how both eval suites were built, the 0.4.0 results with their intervals, what they do not show, and what the next round needs.
  [Evals](Evals) has it now.
- `docs/claude-code-prompt-surface.md`: what Claude Code 2.1.283 sends per request, what each customization lever changes, and `policyHelper` output fields that the docs do not cover.
  [Prompt surface](Prompt-Surface) has it now.
  See [Prompt-Surface](Prompt-Surface).

## Changed

- Shorter prompts with the same rules.
  This covers the output style, agent and skill descriptions and bodies, the SubagentStart conventions, and the global `CLAUDE.md` section.
  Prompts no longer repeat rules that Claude Code's own prompt or tool descriptions already send, or rules that the SubagentStart text already gives an agent.
  The closing `<tone_preference>` line of the output style is gone.
- The global `CLAUDE.md` section has no heading of its own.
  The script adds a `# CLAUDE.md` top-level heading when the file has none.
- Markdown headings use capitalized words.
- `wrong-diagnosis` eval: it expects the reproduced cause in `sum()` fixed and `format()` unchanged, instead of one exact fix.
- `scope-follow-up` eval: it expects the second bug fixed after an MRE and reported separately.
- `handoff-note` eval: the prompt carries a session's goal, state, decisions, and open items, so no section is correctly empty.

## Fixed

- Stop gate: a reply that mentioned an error or failure that it had fixed ("fixed the parser error") counted as an admission.
  The admission said that the change was unverified.
  An edit with no check after it then ended the turn unchallenged.
  Now only an explicit "not run" or "unverified" statement counts.
  When the gate sends Claude back, it also asks for the complete report again, because that reply replaces the earlier one as the report.
- Edit guard: removing test assertions no longer asks when the user requests it ("rip it out: the flag, its tests, all of it").
  The held-out suite found this.
  The ask, which a non-interactive run cannot answer, left a requested removal half done in 2 of 5 runs.
  Adding a skip marker still asks.
- CloakBrowser launcher: `cloakbrowser` declares `playwright-core` as an optional peer.
  Neither `bun install -g cloakbrowser` nor the auto-install of Bun installed it, and the launcher failed with "Cannot find package 'playwright-core'".
  The launcher now loads the global install.
  When `playwright-core` is missing there, it installs the package and restarts itself.
  The install instructions name both packages.
- The `recognize-captcha` frontmatter is valid YAML (its description is quoted).

Previous: [Release 0.3](Release-0.3) · Next: [Release 0.5](Release-0.5)
