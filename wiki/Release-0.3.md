# Release 0.3

Release 0.3.0 (2026-09-26) limited usage and cut prompt size.
It capped effort and workflow size, and it replaced the heavy CodeGraph prompt hook with a light one.
It also replaced the built-in Codex instructions with dotclaude templates.
Release 0.3 requires Claude Code v2.1.283 or later.
After you update:

1. Restart Claude Code.
1. Run `/dotclaude:apply-settings-profile` again.
1. If you use the Codex agents, run `/dotclaude:setup-integrations codex` again.

## Added

- Effort cap: the settings profile sets `maxEffortLevel: "xhigh"`.
  The session, agents, skills, and workflow stages cannot use `max`.
  The claude.ai effort picker warns that `max` uses about 5.5x the usage on Opus 5.5 and 3.5x on Fable 5.1.
- Workflow bounds in the settings profile:
  - `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=6`, a hard cap per run.
  - `workflowSizeGuideline: "medium"`, advice to aim for fewer than 10 agents.
- `$schema` in the settings profile.
- `install-managed.mjs`, an optional lock that you run with `sudo` in your own terminal.
  - It writes `managed-settings.d/50-dotclaude.json` with the effort cap, fast mode off, and the model list.
  - It never touches `managed-settings.json`.
  - It checks the file before it moves the file into place, and asks before it replaces a different file.
  It keeps backups outside the drop-in directory.
- `/dotclaude:<skill>` works anywhere in a message.
  When the command is not at the start, a UserPromptSubmit hook injects the skill with the rest of the message as `$ARGUMENTS`.
  For a skill that must run as a command, the hook tells Claude how to start it.
- A PostModelSwitch hook gives the Fable 5.1 note to a session that switches to Fable, and retracts it on a switch away.
  The session-start note alone missed those sessions, because the `model` field is not always present there.
- Codex prompt replacement: `/dotclaude:setup-integrations codex` builds three model catalogs.
  They are `dotclaude-catalog-interactive.json`, `dotclaude-catalog-worker.json`, and `dotclaude-catalog-review.json`.
  - The model list comes from `codex debug models`, run under a temporary Codex home that links to your login.
    A catalog stops Codex from refreshing its own list, so this method lets a new run of setup find new models.
    When the request fails, `models_cache.json` is the fallback.
  - For GPT-6 Astra, Sol, and Luna, dotclaude's templates replace the built-in instructions of 18 to 21 KB.
    The persistent-mode and multi-agent role text is removed.
  - `config.toml` and each dotclaude profile point at their own catalog through `model_catalog_json`.
  - Both profiles set `include_collaboration_mode_instructions = false` and `include_apps_instructions = false`.

## Changed

- CodeGraph prompt context is a light dotclaude hook, on with `codegraph_hint`.
  It replaces `codegraph prompt-hook`.
  That command injects up to 9 KB of explored source on any prompt with a word such as "how" or "call".
  This includes task notifications and subagent hand-backs.
  - For prompts you type, the hook looks up the code-shaped names in them (camelCase, snake_case, `name(`, `a.b`) with `codegraph query`.
    It lists only the names that the index has, as name, kind, and file:line.
    Claude calls `codegraph_explore` for the source when it needs it.
  - The setup skill tells you to remove the global `codegraph prompt-hook` entry that `codegraph install` adds.
- `web-researcher` runs on Opus 5.5 at low effort, with `maxTurns` 60, instead of Haiku 4.5.
  - It backs each "exists" or "does not exist" claim with the source line that it read.
  - It gets raw pages instead of WebFetch summaries.
  - It reports as soon as the question has an answer.
- Claude can load `recap`, `challenge`, `blind-spots`, and `lessons-learned` when you ask for what they do.
  `polish`, `troubleshoot`, `fresh-eyes`, `review-code-changes`, and `apply-settings-profile` still run only when you name them.
- Output style:
  - Claude answers a correction with the right fact or the changed action.
    The quoted banned phrase is gone, because quoting it primed it.
  - The line before the first tool call names what Claude does to your task, not how tools or skills load.
  - Claude ends a turn with a question only when the answer changes the next step.
  - New guidance covers a subagent that stopped at its turn limit, and cheap `agentType` and `effort` choices in workflow scripts.
  - The style is no longer than before.
- The session-start staleness notice also checks for the effort cap.
  It looks at user, project, and local settings, and at managed settings and their drop-ins.
- The Codex worker profile drops `compact_prompt`, which has no effect with remote compaction on GPT-6.
  Its `developer_instructions` now match the worker template: Claude lists assumptions instead of stopping to ask.
- The `verify-before-stop` gate counts these commands as check runs:
  - `bun run validate` (and the `validate` scripts of other package managers)
  - `claude plugin validate`
  - `markdownlint` and `markdownlint-cli2`
- The Codex load check runs `codex -p <profile> debug prompt-input` for both profiles.
- `bun test ./tests/` replaces `bun test tests/` in `package.json` and CI.
  The bare form is a path filter that also found tests under ignored directories.
- The Markdown passes markdownlint.
  The shared rules moved to `.markdownlint.jsonc`.
  Prompt files in `agents/`, `skills/`, `output-styles/`, and `evals/` are exempt from the 80-column limit and keep their step numbers.
  Two skills had a code fence directly after an XML tag, which Markdown read as part of the tag.
  A blank line now separates them.

## Removed

- The `codegraph_prompt_context` option, which ran `codegraph prompt-hook` on typed prompts.
  The `codegraph_hint` hook replaces it.
- `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` from the settings profile.
  Claude Code removed it in v2.1.224, so it has no effect.
  A new run of the profile removes it from settings that an earlier version wrote it to.

## Fixed

- The stop gate counted any quoted string in inline interpreter code as an edited file.
  A regex literal, or a file that the script only read, counted as an edit and caused "Code changed … no test ran".
  Now the gate records only the path argument of an actual write call.
  Paths after a `cd` resolve against that directory.
- The guard tests failed inside a session with the dotclaude profile applied, because `ANTHROPIC_DEFAULT_SONNET_MODEL` leaked into alias resolution.
  The tests now clear the model alias variables.

Previous: [Release 0.1 and 0.2](Release-0.1-0.2) · Next: [Release 0.4](Release-0.4)
