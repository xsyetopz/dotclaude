# dotclaude Dossier: Claude Code Prompt Surface

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

## 5. Claude Code Prompt Surface

### What A Request Contains

An interactive session with plugins, MCP servers, and the dotclaude output
style, with tool search on (**capture**):

| Part | Size | Contents | Replaced by `--system-prompt-file` |
| --- | ---: | --- | --- |
| `system` blocks | 6.4 KB | billing header, identity line, the built-in prompt | the prompt only |
| `messages[0]`, user | varies | `CLAUDE.md` files and the auto-memory index | no |
| `messages[1]`, role `system` | 34 KB | environment, output style, hook context, agents, skills, MCP instructions, date | no |
| `tools`, loaded | 69.5 KB | 14 full definitions, Artifact alone 34 KB | no |
| `tools`, deferred | 0.3 KB | names only, loaded on demand | no |
| Whole request | 122 KB | | about 6 KB less |

Without tool search, all 38 tools load in full: a 205 KB request. Tool search
is off by default when `ANTHROPIC_BASE_URL` points to another host.

### The Lean Prompt

The profile sets `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`. The first match in this
list decides the prompt (**binary**):

1. The variable is truthy: lean.
1. The variable is `0` or `false`: full.
1. The provider is Bedrock, Vertex, or Foundry: lean.
1. The feature flag `tengu_velvet_tide` is on: lean.
1. The feature flag `simple_system_prompt` decides.

The lean prompt drops the long system bullets, the coding rules, "Executing
actions with care", the task-tool section, and the tone section. It keeps a
one-line form of the first four. The same switch sends shorter descriptions
for Glob, Grep, Write, and WebSearch.

### dotclaude's Working Rules

Only the `--system-prompt-file` flag replaces the built-in prompt. No setting
or environment variable does (**binary**, all settings keys and
`CLAUDE_CODE_*` names with SYSTEM, PROMPT, or STYLE). A plugin cannot pass
flags. So dotclaude 0.16 installed a `claude` shell function that passed the
flag with a 4.3k-token replacement prompt.

0.17 removed the shell function.
The profile turns on the lean prompt, and dotclaude adds its engineering, git, and report rules to every session.
0.17 put the rules in an output style, and 0.18 moves them to a SessionStart hook (`hooks/session-start/add-working-rules.mjs`).
The rules are about 7 KB (`LIMITS.workingRulesBytes`).
The 0.16 prompt and style took about 4.9k tokens.

- The 2.1.287 prompt has the `<pasted_content>` rule, the `/<skill-name>`
  and `! <command>` guidance, and the rule on hard-to-reverse actions
  (**binary**). So the rules keep only the parts of the approval rule that are dotclaude's own.
- The profile turns auto memory off, so no `# Memory` section is necessary.
- The header and identity line are always sent (**capture**).

Anthropic's published model system prompts are the Claude apps' prompts, not
Claude Code's. Use them for tag structure only.

### Output Styles And Hook Context

An output style arrives in the role-`system` message, not in the `system`
blocks (**capture**). The docs say that the style is "appended to the end of
the system prompt", which 2.1.283 does not do.

`keep-coding-instructions` changes only the full prompt. The lean prompt has
no coding instructions, and the flag does not add them (**binary**, 2.1.286).
With the 0.16 replacement prompt, `true` sent the same request as `false`
(**capture**).

The `additionalContext` of a SessionStart hook arrives in the same role-`system` message as the output style (**capture**, 2.1.288).
So text from a hook has the same position as a style, and it applies with every style and with no style.
This is why the working rules moved from the styles to a hook, and each style now holds only its reply-style rules.

Observed behavior of SessionStart context in 2.1.288:

- Claude Code keeps at most about 10,000 bytes of output from each hook command (**binary**).
  The limit applies per command, not per event.
  So the rules have their own command in `hooks.json`, and the other SessionStart actions share the dispatcher's command.
- After `/compact` or an automatic compaction, Claude Code runs the hook again with source `compact`, and it drops the copy from startup (**capture**).
  So the rules come back after each compaction, and the text is not sent twice.
- With `--resume`, the earlier copy stays in the transcript, so a new copy would be a duplicate.
  The hook adds the rules only for the sources `startup`, `clear`, and `compact`, and not in subagents.
- No setting or hook output appends text to the built-in system prompt itself.
  The role-`system` message is the closest position that a plugin can reach.

### Built-In Plugins

Claude Code 2.1.288 ships built-in plugins with ids of the form `cc-plugin-<name>@builtin` (**binary**).
The short form `<name>@builtin` also resolves.
`enabledPlugins` in settings turns each one on or off:
`tips`, `mermaid`, `diff`, `mods-guide`, `claude-test`, `responsive-mode`, `plugin-authoring`, `telemetry`, `agents-md`, and `you-should-know`.
`sec-default` reads its switch only from managed policy.
`you-should-know` is off by default.
The 2.1.287 release notes say that it needs a first-party session with telemetry on.
Its registration checks a feature flag, `tengu_jolly_dewdrop`, and three compliance modes (HIPAA, ZDR, LDR), not the `telemetry` plugin (**binary**).
The flag comes from the feature-flag fetch, which the telemetry settings control.
`you-should-know` runs when the `telemetry` plugin is off (**tested**, 2.1.288).
In a headless session with `cc-plugin-telemetry@builtin: false`, the debug log showed the plugin admitted and its `prompt.submit`, `turn.step`, and `session.end` hooks run.
Its `telemetry.log` and `telemetry.mark` calls then go to no handler, and nothing is sent.
The `telemetry` plugin is on by default.
The setup switch `builtin-plugins` turns `you-should-know` on and the others off.

### Skill Listing And claude.ai Connectors

Settings keys that change the skill listing (**binary**, 2.1.288):

| Key | Effect |
| --- | --- |
| `disableBundledSkills` | removes the skills that ship with Claude Code |
| `skillOverrides` | per skill: `on`, `name-only`, `user-invocable-only`, or `off` |
| `skillListingMaxDescChars` | cuts each description to this many characters (default 1536) |
| `skillListingBudgetFraction` | the share of the context window for the whole listing |

Skills synced from a claude.ai account have names of the form `anthropic-skills:<name>`, and `skillOverrides` matches that name.
`disableClaudeAiConnectors` removes the MCP connectors from a claude.ai account.
A `true` value in any settings source wins, so a project can turn the connectors off, but a project `false` cannot turn them on again after a user `true`.
So the maintainer turns them off only for this repository, in `.claude/settings.local.json`.

### Tool Removal

A bare tool name in `permissions.deny` removes that tool's definition, as
`--disallowedTools` does (**capture**). Only a loaded tool saves much, because
a deferred tool costs one name.

| Tool | Bytes |
| --- | ---: |
| Artifact | 34037 |
| SendFeedback | 5508 |
| Workflow | 5355 |
| AskUserQuestion | 4897 |
| ScheduleWakeup | 4631 |
| Agent | 3049 |
| Bash | 2237 |
| ReportFindings | 2177 |

### Undocumented Surfaces

- `--append-subagent-system-prompt[-file]` works only with `-p` (**official**).
  The bundle gates it behind `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT`.
  Nobody tested it in an interactive session.
- The `policyHelper` output accepts two optional strings besides
  `managedSettings`: `appendSystemPrompt` and `claudeMd` (**binary**). They
  append text and cannot replace the prompt. Nobody has run them end to end.
- The Glob tool runs `rg --files --no-ignore --hidden` unless
  `CLAUDE_CODE_GLOB_NO_IGNORE` or `CLAUDE_CODE_GLOB_HIDDEN` is `false`
  (**binary**, **measured**). The Grep tool skips gitignored files. The
  profile sets `CLAUDE_CODE_GLOB_NO_IGNORE=false`.

### Capture Method

A local HTTP listener stood in for the API. It saved each `/v1/messages`
request body and answered 400.

```sh
ENABLE_TOOL_SEARCH=true ANTHROPIC_BASE_URL=http://127.0.0.1:18771 \
  gtimeout 40 script -q /dev/null claude "hi" </dev/null
```

`script` gives the CLI a terminal, so it runs interactively. To measure print
mode, remove `script` and add `-p`. The request bodies contain the user's
`CLAUDE.md`, so this file reports only structure and sizes.

### Count The Injected Text

`scripts/count-tokens.mjs` counts the tokens of the working rules, each output
style, the SessionStart Fable note, the subagent conventions, and each agent prompt. It
is opt-in, because it calls the API. Run
`ANTHROPIC_API_KEY=... bun scripts/count-tokens.mjs`, and add `--json` for
JSON. Each count is for the text alone, with the count of a one-word message
taken off. Without the key, the script exits with code 1.
