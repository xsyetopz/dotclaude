# Release 0.7

Release 0.7.0 (2026-09-28) cut usage that a measured week of real sessions showed.
It added a context budget for subagents and made subagents run in the foreground.
It removed Codex support, the general workflow skills, and the CodeGraph hooks, because each cost more than it gave.
The limits suit Pro and Plus and apply on every plan.
Larger plans only reach the limits later.
`docs/pro-first-usage.md` held the measurements.
[Usage evidence](Usage-Evidence) has them now.

## Added

- `docs/pro-first-usage.md`: where the Max 20x week of this machine went, what that means for Pro, and the Codex quota and dossier findings.
  It also gives the case for and against the GPT-5.6 models.
- A context budget for every subagent.
  Once the context of an agent passes 150k tokens, the hook refuses its tool calls, and its next action is its report.
  A fork starts with the context of its parent, so it gets 50k tokens of growth instead.
  In the measured week, 83% of `implementer` cost and 85% of `general-purpose` cost came from calls above 100k tokens.
  The hook is now `enforce-agent-budget.mjs`, still under the `turn_limit_handoff` option.
  Subagents learn the limit at start.
- A refusal of `general-purpose` agents, with a pointer to the dotclaude agent for the job (part of `subagent_guidance`).
  They were 17.5% of the measured week: 83 explicit calls, mostly implementation slices with no turn limit.
  With forks off, a call without `subagent_type` spawns `general-purpose`, so the hook refuses that call too.
- Subagents run in the foreground.
  The same hook sets `run_in_background: false`, and the settings profile sets `CLAUDE_CODE_FORK_SUBAGENT=false`, because fork mode forces every subagent into the background.
  A background agent woke the main conversation when it finished, once for its report and once for its task notification.
  This happened in 501 of 861 main turns in the measured week and caused 20.6% of cost.
  A foreground agent returns its report in the turn that spawned it.
  Agents that one message spawns still run together, and the main session waits while they run.
- `scripts/usage-report.mjs` reports where the last N days of Claude Code usage went:
  - API-equivalent cost by agent type
  - the share from calls with context past 150k tokens
  - the share spent on full cache rewrites
  - the main turns that background agents started
- `hooks/lib/_budget.mjs` holds the usage bounds.
  A test checks that the output style, the settings profile, and the option text agree with it.
  The test also checks that the output style plus the agent and skill descriptions stay under 21.5 KB.

## Changed

- A `/dotclaude:` skill typed mid-message runs through the Skill tool.
  Before, the hook pasted the skill body into the context.
  The skill now loads the way Claude Code loads it (forks, `!` commands, model and tool settings).
  A large skill is no longer cut at 9.5 KB.
  It costs one extra call per mid-message skill.
- The settings profile turns off built-in Claude Code features that cost context or turns, from `profiles/optional.json`.
  The profile applies each feature unless you skip it with `--skip`.
  - The Artifact, Workflow, `ScheduleWakeup`, cron, and ReportFindings tools (about 46 KB on every request together)
  - the advisor
  - the Explore and Plan agents
  - bundled skills
  - auto memory
  - the refusal retry
  - auto-updates

  The profile stamp covers both files.
- The output style makes the main conversation the default place to work.
  Claude delegates only output that would flood the context, or parallel slices that the user asks for.
- The settings profile no longer denies `AskUserQuestion`.
  Its 4.9 KB per request is about $2 a week of cached reads at the measured volume, and a structured question is worth that.
  `apply-settings` does not remove old denies, so remove `"AskUserQuestion"` from `permissions.deny` in `~/.claude/settings.json` yourself.
- The settings profile compacts at 200k tokens on every plan.
  It was 400k on Max 20x.
  Run `/dotclaude:apply-settings-profile` to apply it.
  The session note asks for a handoff past about 200k on every plan, and the output style says 200k instead of 400k.
- The settings profile runs 3 subagents at once, and 3 agents at once in a workflow.
  It was 6.
- Session start detects a stale settings profile with one stamp instead of a check per release.
  `/dotclaude:apply-settings-profile` writes `env.DOTCLAUDE_SETTINGS_PROFILE`, a hash of the shipped profile.
  When the stamp is missing or differs, session start asks you to apply the profile again.
  This replaces the checks for a missing Haiku mapping, a missing effort cap, and the old 400k compaction window.
  Every existing install sees the notice once.

## Removed

- Codex support:
  - the `codex-worker` and `codex-reviewer` agents
  - the `codex-fanout` skill
  - Codex setup (`skills/setup-integrations/codex/`, `configure-codex.mjs`, `build-codex-catalog.mjs`)
  - the `codex_delegation` and `allowed_codex_models` options
  - the Codex Bash-guard rules
  - every other Codex mention across the hooks, output style, and settings profile

  Reason: a second model source cost more to maintain than it gave.
  Delegation also spent Claude turns that forwarded briefs to GPT-6 workers and reviewed their diffs.
  If you ran `/dotclaude:setup-integrations codex`, you may remove the files that it wrote under `$CODEX_HOME` (usually `~/.codex/`):
  - `dotclaude-luna.config.toml` and `dotclaude-review.config.toml`
  - `dotclaude-catalog-interactive.json`, `dotclaude-catalog-worker.json`, and `dotclaude-catalog-review.json`
  - any `*.dotclaude-backup-<timestamp>` files next to them

  Setup also set `service_tier`, `model_catalog_json`, `[features] fast_mode`, and on the Plus plan `model`, in `config.toml`.
  Remove those lines yourself to get the defaults of Codex back.
- The skills that are not part of dotclaude's own machinery: `blind-spots`, `challenge`, `fresh-eyes`, `lessons-learned`, `polish`, `recap`, `troubleshoot`, and `review-code-changes`.
  dotclaude keeps the skills that its features use (settings profile, integrations, handoff, browser, CAPTCHA).
  General workflow skills belong in [xsyetopz/skills](https://github.com/xsyetopz/skills), where `debug-software-failures` covers `troubleshoot`.
  The `code-reviewer` agent still runs on request.
  Four of the removed skills were in the skill listing on every turn.
- Cleanup of old settings in `apply-settings`.
  The script no longer removes settings that earlier profiles wrote.
  - If your `env` still holds `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-5-5` from 0.4.0, remove it yourself.
    Otherwise every `sonnet` agent runs on Opus 5.5.
  - The script no longer removes `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` from 0.2.0 either.
    Claude Code 2.1.283 still reads it, so the earlier claim that it had no effect was wrong.
- The CodeGraph hooks and the `codegraph_hint` option.
  The session-start note and the per-prompt symbol list repeated what the CodeGraph section already says.
  `codegraph install` writes that section into `~/.claude/CLAUDE.md`.
  The setup skill now checks for that section, and it still tells you to remove the global `codegraph prompt-hook` entry.

## Fixed

- A `/dotclaude:` skill name inside pasted text or a `>` quote no longer loads that skill.

Previous: [Release 0.6](Release-0.6) · Next: [Release 0.8](Release-0.8)
