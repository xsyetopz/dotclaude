# Claude Code Prompt Surface (v2.1.283)

This page records what Claude Code 2.1.283 actually sends to the model, what
each customization lever changes, and what the CLI supports that the public
docs do not describe yet. Where the shipped CLI and the docs disagree, the
CLI's behavior is recorded here as fact, and the docs are treated as stale.

Every claim carries its source:

- **[capture]**: measured from a request body the CLI sent. The method is at
  the end of this page.
- **[bundle]**: read from the shipped JavaScript bundle. Read only; nothing
  was patched.
- **[docs]**: code.claude.com, fetched on 2026-09-26.
- **[release]**: GitHub release notes.

The captures cover one account, macOS, the first request of a session, with
the dotclaude output style active. Other accounts or later turns may lay the
request out differently. The bundle has an environment variable named
`CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM`, which suggests the layout below
is gated.

## What A Request Contains

This is an interactive session in a repository with plugins, MCP servers, and
the dotclaude output style active. [capture]

| Part | Size | Contents | Changed by `--system-prompt-file` |
| --- | ---: | --- | --- |
| `system` blocks | 6.4 KB | billing header, identity line, the static built-in prompt | Replaced, except the header and identity line |
| `messages[0]`, user | varies | `<system-reminder>` with `CLAUDE.md` files and the auto-memory index | No |
| `messages[1]`, role `system` | 34 KB | environment, output style, agent list, skills, MCP server instructions, permission-mode notes, date, advisor | No |
| `tools`, loaded | 69.5 KB | 14 full definitions; Artifact alone is 34 KB | No |
| `tools`, deferred | 0.3 KB | the rest, sent as names for ToolSearch to load on demand | No |
| Whole request | 122 KB | | about 6 KB less after replacement |

Tool search was on for these numbers, as it is by default against Anthropic's
API. It turns off by default when `ANTHROPIC_BASE_URL` points elsewhere, which
the capture method below does, so the captures set `ENABLE_TOOL_SEARCH=true`.
Without it, all 38 tools loaded in full: 154 KB of definitions and a 205 KB
request. [capture]

### The Static `system` Blocks

In order [capture]:

1. A billing header, `x-anthropic-billing-header: cc_version=...`.
1. An identity line. Interactive sessions send "You are Claude Code,
   Anthropic's official CLI for Claude." `claude -p` sends "You are a Claude
   agent, built on Anthropic's Claude Agent SDK."
1. The built-in prompt, about 6.2 KB:
   - a line saying the model follows the user's "Output Style";
   - an `IMPORTANT:` paragraph on security work;
   - `# Harness`, whose bullets cover markdown output, permission modes,
     system reminders, `<pasted_content>` handling, preferring dedicated
     tools, and `file:line` references;
   - one line on matching the surrounding code style;
   - the they/them pronoun rule;
   - a paragraph on confirming before hard-to-reverse actions and on
     reporting outcomes faithfully;
   - `# Session-specific guidance`;
   - `# Memory`, the auto-memory instructions including the memory directory
     path;
   - `# Environment`, which lists current model IDs and product surfaces;
   - `# Context management`, and a closing paragraph on acting once enough is
     known.

`--system-prompt-file` replaces the built-in prompt only. The header and
identity line are still sent. [capture]

### The Role-`system` Message

`messages[1]` holds [capture]:

- the dynamic environment: working directory, platform, shell, OS version,
  scratchpad path, and model;
- the active output style, under `# Output Style: <plugin>:<name>`;
- the agent list;
- skill listings;
- MCP server instructions;
- permission-mode notes;
- the date;
- tool-specific blocks such as the advisor.

This message is byte-identical whether or not the system prompt is replaced.

## What Each Lever Changes

### `--system-prompt` And `--system-prompt-file`

These replace the static built-in prompt, about 6.2 KB and 5% of the request
above. The output style, the environment, `CLAUDE.md`, and the tool
definitions are all still sent. [capture]

Replacing the prompt also removes the `# Memory` section, so auto-memory stops
receiving its instructions and directory path unless the replacement text
supplies them. The `<pasted_content>` handling, the security paragraph, and
the confirm-before-acting paragraph go with it too. [capture]

Since 2.1.283 the text and `-file` forms can be passed together, and the
file's text comes first. [release] Replacement is available only as a CLI
flag. The scope searched for another route was the settings schema in the
bundle and every `CLAUDE_CODE_*` environment variable whose name contains
SYSTEM, PROMPT, or STYLE; neither offers one. A plugin cannot pass CLI flags,
so a persistent replacement needs a launcher: a shell function or wrapper
around `claude`. [bundle]

### Output Styles

An output style is not the system prompt. Its body is sent as part of the
role-`system` message, not in the `system` blocks, and it survives
`--system-prompt-file`. [capture]

With the dotclaude style active, none of the headings "Doing tasks", "Tone
and style", or "Executing actions with care" appear anywhere in the request.
[capture] What a style with `keep-coding-instructions: true`, or no style,
sends instead was not measured.

The docs describe the style as "appended to the end of the system prompt".
[docs] In 2.1.283 it lands in a separate system-role message.

### Removing Tools

A bare tool name in settings `permissions.deny` removes that tool's
definition from the request, as `--disallowedTools` does. [capture] It needs
no launcher, because settings, including a settings profile, can carry it.

Only denying a loaded tool saves much, since a deferred tool costs one name.
The loaded set, by size [capture]:

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
| Skill | 1803 |
| Read | 1588 |
| ToolSearch | 1440 |
| ListAgents | 1151 |
| Edit | 964 |
| Write | 639 |

### Subagent Prompts

`--append-subagent-system-prompt[-file]` works only with `-p`. [docs] The
bundle gates the same feature behind `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT`
and annotates it verbatim: "@internal Additional system prompt appended to
every Task-tool subagent (and propagated to nested subagents). Gated by
`CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT`." [bundle] Its behavior in
interactive sessions has not been tested.

## `policyHelper` Output Fields Missing From The Docs

The docs describe the `policyHelper` stdout envelope as a JSON object whose
settings go under `managedSettings`. [docs] (See settings-reference,
`policyHelper`, "Write the helper output".)

The 2.1.283 bundle's envelope schema has two more optional string fields
[bundle]:

```text
{ managedSettings?: object, claudeMd?: string, appendSystemPrompt?: string }
```

- **`appendSystemPrompt`**: the system-prompt builder joins it after the
  `--append-system-prompt` value, separated by a blank line.
- **`claudeMd`**: the CLI reads it. Where its text is injected was not
  traced.
- **Remote re-runs**: neither field applies when the helper was armed by a
  server-managed settings removal. In that case the accessor returns no
  output.

These fields append; they cannot replace the system prompt. They were read
from the bundle and have not been run end to end.

A helper that emits `managedSettings` becomes the only managed-settings
source for the session, which overrides managed-settings drop-ins. A helper
that fails at startup stops Claude Code from starting. [docs]

## Method

A local HTTP listener stood in for the API. It saved each `/v1/messages`
request body and answered 400. The CLI ran against it with
`ANTHROPIC_BASE_URL` set:

```sh
ENABLE_TOOL_SEARCH=true ANTHROPIC_BASE_URL=http://127.0.0.1:18771 \
  gtimeout 40 script -q /dev/null claude "hi" </dev/null
```

`script` gives the CLI a terminal, so it runs interactively. Drop it and add
`-p` to measure print mode. The listener saved only request bodies. Those
bodies contain the user's `CLAUDE.md` and memory index, so this page reports
their structure and sizes rather than their text.
