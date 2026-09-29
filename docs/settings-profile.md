# Settings Profile

Part of the [dotclaude documentation](README.md).

`/dotclaude:apply-settings-profile` merges
`skills/apply-settings-profile/profiles/recommended.json` into your user,
project, or local settings. It shows every change and makes a backup first.
The merge only adds keys. It replaces only the model policy
(`availableModels` and the `Agent(model:...)` denies).

**Why a skill writes settings:** Claude Code applies only `agent` and
`subagentStatusLine` from a plugin. A plugin cannot set permissions,
environment variables, or models, so the skill writes them into a file that
you choose and can review.

## Settings And Their Reasons

- **Models:** Opus 5.5 for the session and the advisor, Sonnet 5.5 for
  built-in subagents, and Haiku 4.5 for background tasks. Fable is denied as a
  subagent model. Fast mode and `ultracode` are off, and
  `fastModePerSessionOptIn` makes each session start with fast mode off. See
  [Models](models.md) for the reasons.
- **Effort:** `maxEffortLevel: "xhigh"` blocks `max`, which uses about 5.5
  times the usage on Opus 5.5. Opus 5.5 defaults to medium. See
  [Effort](models.md#effort).
- **Compaction at 150k tokens on every plan** (`autoCompactWindow`). The
  default on current models is about 967k. Each turn re-reads the whole
  context, and calls over 150k tokens were 74.7% of the measured cost. With
  compaction at 200k, main-conversation calls over 150k were still 13% of the
  cost. Claude Code accepts values from 100k to 1M. The
  bound is sized for Pro, and larger plans reach their limits later
  ([design](dossier/design.md)).
- **No background re-reads:** prompt suggestions, automatic recaps, and idle
  message delivery from your other sessions are off
  (`promptSuggestionEnabled`, `awaySummaryEnabled`, `crossSessionInbound`).
  Each of them sends a request that re-reads the conversation. `/recap` still
  works.
- **Prompt cache:** Claude Code sets the TTL. On an API key or usage credits
  it is five minutes. Set `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` if you often pause
  longer. dotclaude does not set a 1-hour TTL for subagents, because it
  measured about $170 a week worse ([rejected
  alternatives](dossier/design.md#rejected-alternatives)).
- **Fan-out:** 5 subagents at once, and 5 agents at once in a workflow. Forks
  are off, so subagents run in the foreground and do not wake the main
  conversation. The workflow keyword trigger is off, because a workflow is
  multi-agent fan-out, the most expensive way to spend a plan. Claude Code
  gives every workflow agent your latest chat message
  ([#95369](https://github.com/anthropics/claude-code/issues/95369)), so send
  nothing unrelated while a workflow runs.
- **Prompt and tools:** the lean built-in prompt
  (`CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`) drops long sections that dotclaude's
  own prompt replaces ([the lean
  prompt](dossier/prompt-surface.md#the-lean-prompt)). The task-list tools
  are on for the [open-task check](hooks.md#open-task-check-task_check). Glob
  skips gitignored files (`CLAUDE_CODE_GLOB_NO_IGNORE=false`). Without it, a
  `**/*.swift` search returned files under `.build/` and `node_modules/`.
- **Feedback:** `/feedback`, the feedback tool, surveys, and error reports are
  off. This removes the SendFeedback tool, about 5.5 KB, from every request.
  Telemetry stays on, because turning it off also stops the feature-flag
  fetch that the advisor tool needs.
- **Permissions:** read denies for `.env` files and credential directories
  (`~/.ssh`, `~/.aws/credentials`, `~/.gnupg`, `~/.netrc`,
  `~/.docker/config.json`), because anything that Claude reads goes to the API
  and into the transcript. Bypass mode is off, because it skips every prompt
  that the guards give. Project MCP servers need your approval
  (`enableAllProjectMcpServers: false`), because a cloned repository's
  `.mcp.json` runs programs on your machine.
  `Agent(general-purpose)` removes that agent from the list that Claude
  sees. The plugin's refusal hook kept Claude from using it, but Claude
  asked for it 244 times in one week, because the list still named it.
- **Git:** `includeGitInstructions: false` removes Claude Code's git
  instructions, because dotclaude's system prompt has its own. The
  `git_attribution` option keeps the commit trailer and pull request footer.
- **Auto memory:** off. The memory index loads into every request and grows,
  and it stores facts that nobody reviews and that go stale. Claude then
  treats them as true. Repository files and `CLAUDE.md` are the reviewed
  source.

## Optional Switches

`profiles/optional.json` holds switches that each turn off a built-in feature.
Skip one with `--skip name,...`. The reason for each is in the file:

| Switch | Why it is off |
| --- | --- |
| `artifact` | the Artifact tool is about 34 KB on every request |
| `workflows` | about 5.4 KB per request, and workflows are multi-agent fan-out |
| `loops` | about 4.6 KB per request, and every wake-up is a full turn over the whole context |
| `report-findings` | about 2.2 KB per request, and only `/code-review` uses it |
| `advisor` | each call reads the whole conversation without the cache |
| `explore-plan` | the built-in Explore and Plan agents run on the main model, and dotclaude's agents do their jobs |
| `bundled-skills` | the bundled skills are in the skill listing on every turn |
| `auto-memory` | the index loads into every session, and the files go stale |
| `refusal-retry` | an extra request after each refusal |
| `auto-updates` | an update makes the prompt cache cold, so you choose when |

## System Prompt Launcher

**What:** the skill adds a `claude` function to your shell's startup file
(zsh, bash, fish, or PowerShell). The function passes dotclaude's system
prompt, which holds its engineering and git rules. See
[Working Rules](working-rules.md).

**Why:** only the `--system-prompt-file` flag replaces Claude Code's system
prompt. No setting or environment variable does (**binary**), and a plugin
cannot pass flags. An output style cannot carry the rules, because
`keep-coding-instructions` does not bring the coding rules back
([prompt surface](dossier/prompt-surface.md)).

- The function adds nothing when you pass your own `--system-prompt` or
  `--system-prompt-file`.
- `DOTCLAUDE_SYSTEM_PROMPT=0 claude` starts one session with Claude Code's own
  prompt. Set the same variable to silence the session-start notice in an IDE
  that does not load your shell function.
- `apply-launcher.mjs --remove --apply` removes the function.

## Managed Lock

**What:** `install-managed.mjs`, run with `sudo` in your own terminal, writes
`managed-settings.d/50-dotclaude.json` with the effort cap, fast mode off,
and the model list. It never changes an existing `managed-settings.json`, and
it asks before it replaces a different drop-in.

**Why:** you, or Claude, can remove the effort cap from your own settings.
Managed settings take precedence over user settings, so the lock holds.
