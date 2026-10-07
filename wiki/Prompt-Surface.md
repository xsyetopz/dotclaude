# Prompt surface

This page shows what a Claude Code request contains and where a plugin can add or remove text.
Source labels (official, binary, capture, measured, reported, inference, tested) are in [Home](Home).

## Summary

- A request is 122 KB in an interactive session with tool search on (**capture**).
  Without tool search it is 205 KB.
- Only the `--system-prompt-file` flag replaces the built-in prompt, and a plugin cannot pass flags.
- The profile turns on the lean prompt with `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`.
- Hook context and output styles arrive in the role-`system` message, the closest position that a plugin can reach.
- Since 0.26.0, section 1 of the [operating spec](Operating-Spec) in `plugins/dotclaude/lib/terms.mjs` holds the working rules (bound `RULES_MAX_BYTES`, 2,000 bytes).
  Only the `Concise` output style stays.
  `Explanatory`, `Learning`, and `Proactive` are removed.

## What a request contains

An interactive session has plugins, MCP servers, and the dotclaude output style, with tool search on (**capture**):

| Part | Size | Contents | Replaced by `--system-prompt-file` |
| --- | ---: | --- | --- |
| `system` blocks | 6.4 KB | billing header, identity line, the built-in prompt | the prompt only |
| `messages[0]`, user | varies | `CLAUDE.md` files and the auto-memory index | no |
| `messages[1]`, role `system` | 34 KB | environment, output style, hook context, agents, skills, MCP instructions, date | no |
| `tools`, loaded | 69.5 KB | 14 full definitions, Artifact alone 34 KB | no |
| `tools`, deferred | 0.3 KB | names only, loaded on demand | no |
| Whole request | 122 KB | | about 6 KB less |

Without tool search, all 38 tools load in full, which is a 205 KB request.
Tool search is off by default when `ANTHROPIC_BASE_URL` points to another host.

## The lean prompt

The profile sets `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`.
The first match in this list decides the prompt (**binary**):

1. The variable is truthy: lean.
1. The variable is `0` or `false`: full.
1. The provider is Bedrock, Vertex, or Foundry: lean.
1. The feature flag `tengu_velvet_tide` is on: lean.
1. The feature flag `simple_system_prompt` decides.

The lean prompt drops the long system bullets, the coding rules, "Executing actions with care", the task-tool section, and the tone section.
It keeps a one-line form of the first four.
The same switch sends shorter descriptions for Glob, Grep, Write, and WebSearch.

## The working rules

Only the `--system-prompt-file` flag replaces the built-in prompt.
No setting or environment variable does (**binary**, all settings keys and `CLAUDE_CODE_*` names with SYSTEM, PROMPT, or STYLE).
A plugin cannot pass flags.

| Version | How the rules reached Claude |
| --- | --- |
| 0.16 | A `claude` shell function passed the flag with a 4.3k-token replacement prompt. The prompt and style took about 4.9k tokens. |
| 0.17 | Removed the shell function. The profile turns on the lean prompt, and the rules sit in an output style. Auto memory is off in the profile, and the rules have no `# Memory` section. |
| 0.18 | A SessionStart hook, `add-working-rules.mjs`, about 7 KB (`LIMITS.workingRulesBytes`). |
| 0.20.0 | `plugins/dotclaude/hooks/session-start/add-session-context.mjs` adds `plugins/dotclaude/templates/context/working-rules.md`. The hook also adds `minimal-code.md` from the same folder unless the option `ponytail` is `false`. Auto memory stays on, and `/dotclaude:setup` lists the memory files to review. |
| 0.26.0 | The same hook renders the sections of the operating spec from `plugins/dotclaude/lib/terms.mjs`, and `templates/context/` is gone. Section 1 holds the working rules, and section 2 holds the minimal code rules unless the option `ponytail` is `false`. |

The working rules in 0.19 were the text in `add-working-rules.mjs`.
The 0.20.0 file had 2,197 bytes against a bound of 2,200.
The rendered section 1 of the 0.26.0 spec has the bound `RULES_MAX_BYTES` (2,000 bytes).

- The 2.1.287 prompt has the `<pasted_content>` rule, the `/<skill-name>` and `! <command>` guidance, and the rule on hard-to-reverse actions (**binary**).
  So the rules keep only the parts of the approval rule that are dotclaude's own.
- The rules still have no memory section.
- The header and identity line are always sent (**capture**).

The published model system prompts of Anthropic are the prompts of the Claude apps, not of Claude Code.
Use them for tag structure only.

## Output styles and hook context

An output style arrives in the role-`system` message, not in the `system` blocks (**capture**).
The docs say that the style is "appended to the end of the system prompt", which 2.1.283 does not do.

- `keep-coding-instructions` changes only the full prompt.
  The lean prompt has no coding instructions, and the flag does not add them (**binary**, 2.1.286).
  With the 0.16 replacement prompt, `true` sent the same request as `false` (**capture**).
- The `additionalContext` of a SessionStart hook arrives in the same role-`system` message as the output style (**capture**, 2.1.288).
  So text from a hook has the same position as a style, and it applies with every style and with no style.
- This is why the working rules moved from the styles to a hook.
  The one style left, `Concise`, holds only reply-style rules.

### SessionStart context in 2.1.288

- Claude Code keeps at most about 10,000 bytes of output from each hook command (**binary**).
  The limit applies per command, not per event.
  In 0.19 the rules had their own command in `hooks.json`, and the other SessionStart actions shared the command of the dispatcher.
  Since 0.20.0, one command adds the rules and the notes (in 0.26.0, `add-session-context.mjs`).
- After `/compact` or an automatic compaction, Claude Code runs the hook again with source `compact`, and it drops the copy from startup (**capture**).
  So the rules come back after each compaction, and the text is not sent twice.
- With `--resume`, the earlier copy stays in the transcript, so a new copy would be a duplicate.
  The hook adds the rules only for the sources `startup`, `clear`, and `compact`.
  A `resume` gets only the cold-cache note, when the cache has expired.
- No setting or hook output appends text to the built-in system prompt itself.
  The role-`system` message is the closest position that a plugin can reach.

## Built-in plugins

Claude Code 2.1.288 ships built-in plugins with ids of the form `cc-plugin-<name>@builtin` (**binary**).
The short form `<name>@builtin` also resolves.
`enabledPlugins` in settings turns each one on or off.

| Plugin | Note |
| --- | --- |
| `tips`, `mermaid`, `diff`, `mods-guide`, `claude-test`, `responsive-mode`, `plugin-authoring`, `agents-md` | Switch in `enabledPlugins`. |
| `telemetry` | On by default. |
| `you-should-know` | Off by default. See below. |
| `sec-default` | Reads its switch only from managed policy. |

0.19 had a setup switch `builtin-plugins` that turned `you-should-know` on and the others off.
0.20.0 removed it, and the profile sets no `enabledPlugins`.

<details>
<summary>How you-should-know starts</summary>

- The 2.1.287 release notes say that it needs a first-party session with telemetry on.
- Its registration checks a feature flag, `tengu_jolly_dewdrop`, and three compliance modes (HIPAA, ZDR, LDR).
  It does not check the `telemetry` plugin (**binary**).
- The flag comes from the feature-flag request, which the telemetry settings control.
- `you-should-know` runs when the `telemetry` plugin is off (**tested**, 2.1.288).
  In a headless session with `cc-plugin-telemetry@builtin: false`, the debug log showed the plugin admitted.
  It also showed the `prompt.submit`, `turn.step`, and `session.end` hooks of the plugin run.
- Its `telemetry.log` and `telemetry.mark` calls then go to no handler, and nothing is sent.

</details>

## Skill listing and claude.ai connectors

Settings keys that change the skill listing (**binary**, 2.1.288):

| Key | Effect |
| --- | --- |
| `disableBundledSkills` | removes the skills that ship with Claude Code |
| `skillOverrides` | per skill: `on`, `name-only`, `user-invocable-only`, or `off` |
| `skillListingMaxDescChars` | cuts each description to this many characters (default 1536) |
| `skillListingBudgetFraction` | the share of the context window for the whole listing |

- Skills synced from a claude.ai account have names of the form `anthropic-skills:<name>`, and `skillOverrides` matches that name.
- The setup profile sets `anthropic-skills:docs`, `docx`, `pdf`, `pptx`, and `xlsx` to `off` (**binary**, 2.1.289).
- `disableBundledSkills` does not remove these skills, because they come from claude.ai and do not ship with Claude Code.
- `disableClaudeAiConnectors` removes the MCP connectors of a claude.ai account.
  The profile does not set it, so connectors such as Claude Docs and alphaXiv stay.
- A `true` value in any settings source wins.
  A project can turn the connectors off, but a project `false` cannot turn them on again after a user `true`.
  So the maintainer turns them off only for this repository, in `.claude/settings.local.json`.

## Tool removal

A bare tool name in `permissions.deny` removes the definition of that tool, as `--disallowedTools` does (**capture**).
Only a loaded tool saves much, because a deferred tool costs one name.

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

## Undocumented surfaces

- `--append-subagent-system-prompt[-file]` works only with `-p` (**official**).
  The bundle gates it behind `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT`.
  Nobody tested it in an interactive session.
- The `policyHelper` output accepts two optional strings besides `managedSettings`: `appendSystemPrompt` and `claudeMd` (**binary**).
  They append text and cannot replace the prompt.
  Nobody has run them end to end.
- The Glob tool runs `rg --files --no-ignore --hidden` unless `CLAUDE_CODE_GLOB_NO_IGNORE` or `CLAUDE_CODE_GLOB_HIDDEN` is `false` (**binary**, **measured**).
  The Grep tool skips gitignored files.
  The profile sets `CLAUDE_CODE_GLOB_NO_IGNORE=false`.

## Capture method

A local HTTP listener stood in for the API.
It saved each `/v1/messages` request body and answered 400.

```sh
ENABLE_TOOL_SEARCH=true ANTHROPIC_BASE_URL=http://127.0.0.1:18771 \
  gtimeout 40 script -q /dev/null claude "hi" </dev/null
```

- `script` gives the CLI a terminal, so it runs interactively.
- To measure print mode, remove `script` and add `-p`.
- The request bodies contain the `CLAUDE.md` of the user, so this page reports only structure and sizes.

## Count the injected text

`scripts/count-tokens.mjs` counted the tokens of the working rules, the output styles, and the agent prompts.
0.20.0 removed it, because the features that it served are gone.
A test bounds the rendered section 1 of the operating spec in bytes (`RULES_MAX_BYTES`).

## Related pages

- [Design](Design)
- [Claude mods](Claude-Mods)
- [Plans and models](Plans-and-Models)
