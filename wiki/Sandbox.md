# Sandbox

This page tells how to run Claude Code with this checkout as its plugin, apart from your own Claude Code setup.
It is for AI agents and for people.
Use it to see a hook, the status line, or an agent work in a real session before you release a change.

## Why a sandbox

- `claude --plugin-dir plugins/dotclaude` in your own setup loads the checkout next to your installed dotclaude, your settings, and your sessions.
- A test there can change your settings files and write to your session history.
- The sandbox has its own `CLAUDE_CONFIG_DIR` and `HOME`, so the test changes only the sandbox.
  That includes the shell startup files that `/dotclaude:setup` changes.

## Before you begin

- Install `just`, or use `bun tools/sandbox.mjs` in its place.
- Have a Claude login.
  See [Login](#login).

## Start a sandbox

1. Run this command in the repository root:

   ```bash
   just sandbox
   ```

1. Run `/dotclaude:setup` in the TUI to see the status line.
   It writes the status line settings and the two stubs in `config/dotclaude/`.
1. Put more settings in `config/settings.json` when a test needs them.
1. Remove the sandbox when you finish:

   ```bash
   just sandbox-clean
   ```

Other forms of the command:

```bash
just sandbox -p "prompt"           # one headless turn, output to stdout
just sandbox --model claude-haiku-4-5 -p "prompt"
```

- Arguments after `just sandbox` go to `claude`.
- The script loads the checkout and each plugin in `plugins/`, such as `dotclaude-browser` and `dotclaude-jev`.
- `tools/sandbox.mjs` does the work, and `bun tools/sandbox.mjs` is the same without `just`.

| Variable | Default | Use |
| --- | --- | --- |
| `DOTCLAUDE_SANDBOX` | `dotclaude-sandbox` in the temp folder | Sandbox directory |
| `CLAUDE_BIN` | `claude` on `PATH` | The `claude` executable |
| `CLAUDE_CODE_OAUTH_TOKEN` | Your login token | The login the sandbox uses |

Set `CLAUDE_BIN` when `claude` is a shell function or alias, because the script cannot run those.
The native installer keeps each version at `~/.local/share/claude/versions/<version>`.

## What the script sets up

| Folder | Use |
| --- | --- |
| `config/` | The sandbox `CLAUDE_CONFIG_DIR`. |
| `project/` | An empty git repository. It is the working directory. |
| `home/` | The `HOME` of `claude`. |

- The script removes `ZDOTDIR` and `XDG_CONFIG_HOME` from its environment.
  Your global git config does not apply in the sandbox.
- The `gh` login does not apply either, so a test of the git attribution sees no owner.
  Set `GH_CONFIG_DIR=~/.config/gh` to give `gh` your login name.
- `gh` reads its token from the keychain with the real `HOME`, so a `gh api` call in the sandbox fails, such as the organization owner check.
- The script removes the variables of a Claude Code session that runs the script.
  It removes each variable that has the value your own settings `env` gives it.
  A value that you set on the command line for the sandbox stays.

In `config/.claude.json` the script sets these keys:

- `hasCompletedOnboarding: true` and a `theme`, so the TUI does not show onboarding.
- `projects.<dir>.hasTrustDialogAccepted: true`, so the TUI does not ask for trust.
  On macOS, `/tmp` and `/var` resolve to `/private`, and Claude Code uses the resolved path.
  The script sets both paths.

## Login

A new config directory has no login.
The script gives `claude` a token in its environment only:

1. `CLAUDE_CODE_OAUTH_TOKEN`, when you set it.
   `claude setup-token` makes a long-lived token.
1. If not, your own login token.
   On macOS it is in the Keychain entry `Claude Code-credentials`.
   On other systems it is in `~/.claude/.credentials.json`.
   The script reads `claudeAiOauth.accessToken`.

- The script does not write the token to disk, and it does not print it.
- If it finds no token, run `/login` in the sandbox.
- Use of your token counts against your own plan limits.

Rules for agents:

- Get the approval of the user before you use their login in a sandbox.
- Never put the token in a command line, a file, or your output.
  Command lines show in process lists and in the transcript.
  Give it through the environment only, as the script does.
- A shell `echo` or `env` in the sandbox session shows the token.
  Do not run them there.

## Headless tests

`-p` runs one turn and prints the reply.
Use it for hook behavior that the reply shows.

1. Put test files in `project/` first, for example a `pkg/CLAUDE.md` with a rule that the reply must show.
1. Run the prompt:

   ```bash
   just sandbox --model claude-sonnet-5-5 -p "Run cat pkg/a.ts and describe it."
   ```

1. Add `--debug-file <path>` to see which hooks ran and what they returned.

- Put the prompt before variadic flags such as `--allowedTools`.
  A variadic flag takes all the arguments after it, and then `claude` finds no prompt.
- Add `--allowedTools 'Bash(cat:*)'` when the test needs a tool without a permission prompt.
- A headless run is in the `default` permission mode, and no person can answer a prompt.
  So Claude Code denies each tool that `--allowedTools` does not list, with "you haven't granted it yet".
  This deny is not a decision of the user.
- Before the run, list each tool that the test needs, such as `--allowedTools 'Bash' 'Write' 'Edit'`.

## TUI tests in tmux

The status line, the agent panel, and dialogs show only in the TUI.
Run the TUI in a detached tmux session and read the screen:

```bash
tmux new-session -d -s sandbox -x 150 -y 40 "just sandbox; sleep 60"
tmux send-keys -t sandbox -l 'your prompt'
tmux send-keys -t sandbox Enter
tmux capture-pane -p -t sandbox | tail -30
tmux kill-session -t sandbox
```

- Wait some seconds after the start and after each prompt before you read the screen.
- Send the text with `-l` and `Enter` in a second command.
  If you do not, tmux can read words of the text as key names.
- Subagent rows show under the prompt when a background agent runs.
  Ask for an agent with `run_in_background` to see them.

## Status line commands

To test a status line script without a session, give it input on stdin:

```bash
echo '{"columns":100,"tasks":[{"id":"a1","model":"claude-sonnet-5-5",
  "tokenCount":5000}]}' | bun plugins/dotclaude/status-line/subagents.mjs
```

Claude Code does not log a status line command that works.
To see the input that it gives, set a command in `config/settings.json` that writes stdin to a file, and read that file.

## Clean up

1. Stop each tmux session that you started.
1. Run `just sandbox-clean`.

The sandbox keeps its sessions and settings until you remove it.
That lets you continue a test, but an old sandbox can hide a first-run problem.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `just` in a tmux pane stops with "failed to get current directory" | Run `bun <repo>/tools/sandbox.mjs` in the pane instead. |
| `claude` is a shell function or alias | Set `CLAUDE_BIN` to the executable. |
| No login in the sandbox | Run `/login`, or set `CLAUDE_CODE_OAUTH_TOKEN`. |
| `claude` finds no prompt in a headless run | Put the prompt before variadic flags such as `--allowedTools`. |
| A headless tool call is denied with "you haven't granted it yet" | List the tool in `--allowedTools`. |
| A `gh api` call fails in the sandbox | `gh` reads its token with the real `HOME`. Use a test that does not need it. |

## Related pages

- [Development](Development) lists the repository commands.
- [Parts](Parts) lists the hooks and the status line that you test here.
- [Guards](Guards) tells how to read guard asks and denies.
