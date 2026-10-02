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
| `messages[1]`, role `system` | 34 KB | environment, output style, agents, skills, MCP instructions, date | no |
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

0.17 removes the shell function. The profile turns on the lean prompt, and the
output style carries the engineering, git, and report rules in about 2.3k
tokens (`LIMITS.outputStyleTokens`). The 0.16 prompt and style took about
4.9k tokens.

- The 2.1.287 prompt has the `<pasted_content>` rule, the `/<skill-name>`
  and `! <command>` guidance, and the rule on hard-to-reverse actions
  (**binary**). So the style keeps only the security paragraph and the parts
  of the approval rule that are dotclaude's own.
- The profile turns auto memory off, so no `# Memory` section is necessary.
- The header and identity line are always sent (**capture**).

Anthropic's published model system prompts are the Claude apps' prompts, not
Claude Code's. Use them for tag structure only.

### Output Styles

An output style arrives in the role-`system` message, not in the `system`
blocks (**capture**). The docs say that the style is "appended to the end of
the system prompt", which 2.1.283 does not do.

`keep-coding-instructions` changes only the full prompt. The lean prompt has
no coding instructions, and the flag does not add them (**binary**, 2.1.286).
With the 0.16 replacement prompt, `true` sent the same request as `false`
(**capture**).

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
