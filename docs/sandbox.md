# Test the Plugin in a Sandbox

This guide is for AI agents and for people. It tells how to run Claude Code
with this checkout as its plugin, apart from your own Claude Code setup. Use
it to see a hook, the status line, or an agent work in a real session before
you release a change.

## Why a Sandbox

`claude --plugin-dir .` in your own setup loads the checkout next to your
installed dotclaude, your settings, and your sessions. A test there can
change your settings files and write to your session history. The sandbox
has its own `CLAUDE_CONFIG_DIR` and `HOME`, so the test changes only the
sandbox. That includes the shell startup files that `/dotclaude:setup`
changes.

## Commands

Run these in the repository root:

```sh
just sandbox                       # open the TUI with the checkout as plugin
just sandbox -p "prompt"           # one headless turn, output to stdout
just sandbox --model claude-haiku-4-5 -p "prompt"
just sandbox-clean                 # remove the sandbox
```

Arguments after `just sandbox` go to `claude`. `scripts/sandbox.mjs` does
the work, and `bun scripts/sandbox.mjs` is the same without `just`.

| Variable | Default | Use |
| --- | --- | --- |
| `DOTCLAUDE_SANDBOX` | `dotclaude-sandbox` in the temp folder | Sandbox directory |
| `CLAUDE_BIN` | `claude` on `PATH` | The `claude` executable |
| `CLAUDE_CODE_OAUTH_TOKEN` | Your login token | The login the sandbox uses |

Set `CLAUDE_BIN` when `claude` is a shell function or alias, because the
script cannot run those. The native installer keeps each version at
`~/.local/share/claude/versions/<version>`.

## What the Script Sets Up

The sandbox directory has three parts:

- `config/` is the sandbox `CLAUDE_CONFIG_DIR`.
- `project/` is an empty git repository. It is the working directory.
- `home/` is the `HOME` of `claude`. The script removes `ZDOTDIR` and
  `XDG_CONFIG_HOME` from its environment. Your global git config does not
  apply in the sandbox.

The script also removes the variables of a Claude Code session that runs the
script, and each variable that has the value your own settings `env` gives
it. A value that you set on the command line for the sandbox stays.

In `config/.claude.json` the script sets these keys:

- `hasCompletedOnboarding: true` and a `theme`, so the TUI does not show
  onboarding.
- `projects.<dir>.hasTrustDialogAccepted: true`, so the TUI does not ask
  for trust. On macOS, `/tmp` and `/var` resolve to `/private`, and Claude
  Code uses the resolved path. The script sets both paths.

It also installs the dotclaude status line in `config/settings.json`, and
session start writes the subagent status line stub to `config/dotclaude/`.
Put more settings in `config/settings.json` when a test needs them.

## Login

A new config directory has no login. The script gives `claude` a token in
its environment only:

1. `CLAUDE_CODE_OAUTH_TOKEN`, when you set it. `claude setup-token` makes a
   long-lived token.
1. If not, your own login token. On macOS it is in the Keychain entry
   `Claude Code-credentials`. On other systems it is in
   `~/.claude/.credentials.json`. The script reads `claudeAiOauth.accessToken`.

The script does not write the token to disk, and it does not print it. If it
finds no token, run `/login` in the sandbox. Use of your token counts
against your own plan limits.

Rules for agents:

- Get the user's approval before you use their login in a sandbox.
- Never put the token in a command line, a file, or your output. Command
  lines show in process lists and in the transcript. Give it through the
  environment only, as the script does.
- A shell `echo` or `env` in the sandbox session shows the token. Do not run
  them there.

## Headless Tests

`-p` runs one turn and prints the reply. Use it for hook behavior that the
reply shows:

```sh
just sandbox --model claude-sonnet-5-5 -p "Run cat pkg/a.ts and describe it."
```

- Put the prompt before variadic flags such as `--allowedTools`. A variadic
  flag takes all the arguments after it, and then `claude` finds no prompt.
- Add `--allowedTools 'Bash(cat:*)'` when the test needs a tool without a
  permission prompt.
- Add `--debug-file <path>` to see which hooks ran and what they returned.
- Put test files in `project/` first, for example a `pkg/CLAUDE.md` with a
  rule that the reply must show.

## TUI Tests in tmux

The status line, the agent panel, and dialogs show only in the TUI. Run the
TUI in a detached tmux session and read the screen:

```sh
tmux new-session -d -s sandbox -x 150 -y 40 "just sandbox; sleep 60"
tmux send-keys -t sandbox -l 'your prompt'
tmux send-keys -t sandbox Enter
tmux capture-pane -p -t sandbox | tail -30
tmux kill-session -t sandbox
```

- Wait some seconds after the start and after each prompt before you read
  the screen.
- Send the text with `-l` and `Enter` in a second command. If you do not,
  tmux can read words of the text as key names.
- If `just` in the pane stops with "failed to get current directory", run
  `bun <repo>/scripts/sandbox.mjs` in the pane instead.
- Subagent rows show under the prompt when a background agent runs. Ask for
  an agent with `run_in_background` to see them.

## Status Line Commands

To test a status line script without a session, give it input on stdin:

```sh
echo '{"columns":100,"tasks":[{"id":"a1","model":"claude-sonnet-5-5",
  "tokenCount":5000}]}' | bun hooks/status-line/subagents.mjs
```

Claude Code does not log a status line command that works. To see the input
it gives, set a command in `config/settings.json` that writes stdin to a
file, and read that file.

## Clean Up

Stop each tmux session you started, then run `just sandbox-clean`. The
sandbox keeps its sessions and settings until you remove it. That lets you
continue a test, but an old sandbox can hide a first-run problem.
