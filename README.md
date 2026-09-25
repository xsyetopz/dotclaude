# dotclaude

A Claude Code plugin in two layers. Hooks enforce what can be checked mechanically, and an always-on output style sets working conventions for what can't.

The hooks:

- **Bash guard**: asks before destructive or public commands, even when they are reworded to slip past permission rules (`sudo`, `env`, `VAR=`, `bash -c '...'`, `eval`, `$(...)`, heredocs, `xargs`, interpreter one-liners).
- **Edit guard**: asks before an edit removes test assertions, adds skip/xfail/focus markers, touches generated files or lockfiles, or shrinks a long file to a fraction of its size.
- **Verify-before-stop gate**: when Claude ends a turn after editing code with no later test, build, or lint run, it is sent back once to run the checks or to say the change is unverified. It also catches "tests pass" after a failing run.
- **Compaction carry-over**: after compaction, your last few messages come back verbatim, with `git diff --stat` and the last check result.
- **Fast-mode and model lock**: fast mode stays off, and the session, subagents, and model switches stay on Opus 5.5 (Fable 5.1 allowed).

The conventions: a plugin output style, forced on while dotclaude is enabled, adds working conventions to Claude Code's system prompt. They cover the failure patterns in `docs/ai_coding_agent_user_experience_dossiers_research_updated/`: therapy-speak and praise, agreeing without checking, invented requirements, speculative abstraction and compatibility layers, weakened tests, and completion claims that don't match what ran. Subagents get a short version through a `SubagentStart` hook.

Plus a settings profile you apply with `/dotclaude:apply-settings-profile`, a read-only reviewer agent, and skills to review changes, write a session handoff, and drive a web browser.

Context cost: about 680 tokens of skill and agent descriptions plus about 2,200 tokens of output style per session, both cached after the first request. The hooks add nothing unless they fire.

## Install

```text
/plugin marketplace add xsyetopz/dotclaude
/plugin install dotclaude@dotclaude
```

Then run `/dotclaude:apply-settings-profile` once. A plugin cannot set permissions, environment variables, or models itself, so this step writes them into a settings file you choose, after showing you the diff and making a backup.

Requirements: Claude Code 2.1.269 or later, [Bun](https://bun.sh) 1.4.2 or later on `PATH`, and git.

## What each part does

### Hooks

| Hook | Event | Blocks (deny) | Asks | Says nothing about |
| --- | --- | --- | --- | --- |
| `pre-tool-use/block-destructive-commands.mjs` | PreToolUse Bash | `rm -r` of `/`, `~`, `$HOME`, system dirs; decoded data piped to a shell; commands that turn fast mode on or pick a disallowed model | force push, `push --delete`, `reset --hard`, `clean -f`, `checkout -- .`, `restore`, `stash drop/clear`, `branch -D`, `filter-branch`; `--no-verify`, `HUSKY=0`, `core.hooksPath`; `rm -r` of tracked files or outside the project; `find -delete`; `curl \| sh`; `gh` writes (PR, issue, release, `api -X POST`); `npm/cargo/... publish`; `DROP`/`TRUNCATE`/`DELETE` without `WHERE`; snapshot updates (`jest -u`, `insta accept`); printing secret files; commits that stage `.DS_Store`, `.env`, keys, build output, or a lockfile without its manifest | everything else, including `rm -rf node_modules`, `git push`, reads, and tests |
| `pre-tool-use/confirm-risky-edits.mjs` | PreToolUse Edit/Write | settings edits that enable fast mode or a disallowed model | removed assertions, added skip markers, generated/lockfile edits, large Write shrink, other Claude settings edits | ordinary edits |
| `post-tool-use/record-edits-and-checks.mjs`, `post-tool-use-failure/record-failed-checks.mjs` | PostToolUse, PostToolUseFailure | | | records edits and check runs; never prints |
| `stop/require-verification.mjs` | Stop | | | blocks at most once per state; never re-blocks a continuation |
| `pre-compact/save-recent-prompts.mjs`, `session-start/restore-context-after-compact.mjs`, `session-start/warn-incomplete-setup.mjs`, `session-start/note-codegraph-index.mjs` | PreCompact, SessionStart | | | restores context after compaction; one-line CodeGraph note when `.codegraph/` exists; a notice (to you, not Claude) when fast mode isn't disabled in settings or Bun is older than 1.4.2 |
| `subagent-start/inject-working-conventions.mjs` | SubagentStart | | | gives each subagent the short conventions (skipped for `code-reviewer`, which has its own) |
| `pre-tool-use/restrict-subagent-models.mjs`, `pre-model-switch/restrict-models.mjs`, `config-change/block-fast-mode.mjs` | PreToolUse Agent, PreModelSwitch, ConfigChange | subagent `model` outside the list; model switches outside the list; settings changes that turn fast mode on | | |

The guards never auto-approve anything: a command that matches nothing goes through Claude Code's normal permission flow. Every hook fails open, so a bug in dotclaude cannot stop your work. When a denied command is really what you want, run it yourself with `! <command>`.

The guard is a best-effort parser, not a sandbox. For hard isolation, use Claude Code's [sandbox](https://code.claude.com/docs/en/sandboxing).

### Options

Hooks live in one directory per event under `hooks/`, each file named after what it does, with shared code in `hooks/lib/`. Every hook can be switched off in `/config` under dotclaude, or at install time:

| Option | Default | Controls |
| --- | --- | --- |
| `bash_guard` | on | the Bash guard (the model-lock checks inside it follow `model_lock`) |
| `edit_guard` | on | the Edit/Write guard |
| `stop_gate` | on | the verify-before-stop gate |
| `compact_carryover` | on | restoring context after compaction |
| `subagent_guidance` | on | the short conventions injected into subagents |
| `model_lock` | on | fast-mode and model restrictions in every hook |
| `allowed_models` | `claude-opus-5-5,claude-fable-5-1` | IDs or version prefixes the model lock accepts |
| `commit_hygiene` | on | the staged-file check on `git commit` |
| `codegraph_hint` | on | the CodeGraph line at session start |
| `cloakbrowser` | off | use CloakBrowser instead of agent-browser (antibot) |
| `cloakbrowser_humanize` | on | human-like behavior in CloakBrowser |
| `cloakbrowser_headless` | off | headless mode in CloakBrowser (not recommended for hard targets) |
| `captcha_ocr_ddddocr` | off | offline CAPTCHA OCR fallback via ddddocr-rs |

### Settings profile (`/dotclaude:apply-settings-profile`)

`skills/apply-settings-profile/profiles/recommended.json` sets:

- `env.CLAUDE_CODE_DISABLE_FAST_MODE=1`, `fastMode: false`, `fastModePerSessionOptIn: true`
- `model`, `advisorModel`, `env.CLAUDE_CODE_SUBAGENT_MODEL` to `claude-opus-5-5`; `availableModels` to Opus 5.5 and Fable 5.1; `Agent(model:sonnet*|haiku*)` denies
- `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=4`, `env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION=40`
- `permissions.deny` reads of `.env` files, `~/.ssh`, `~/.aws/credentials`, `~/.gnupg`, `~/.netrc`, `~/.docker/config.json`
- `permissions.disableBypassPermissionsMode`, `enableAllProjectMcpServers: false`, `workflowKeywordTriggerEnabled: false`
- `includeGitInstructions: false`, so the output style's git section replaces Claude Code's built-in commit and PR instructions

The skill also offers a short marked section for `~/.claude/CLAUDE.md` (`skills/apply-settings-profile/profiles/global-claude-md.md`). It names the CLI tools found on the machine, says how to treat dotclaude hook messages, and says to read git state before git work. Re-running replaces the section in place, and `--remove` takes it out; the rest of your CLAUDE.md is never touched.

The merge only adds keys and rule entries; it never deletes yours. User and project settings stay editable by you, so for a lock that also holds against your own `/fast`, put `{"fastMode": false}` in the [managed settings](https://code.claude.com/docs/en/managed-settings) file for your OS. The setup skill prints the path.

### Output style (`output-styles/dotclaude.md`)

The style replaces Claude Code's built-in software-engineering instructions (it doesn't set `keep-coding-instructions`). Claude Code's tool guidance, safety instructions, environment context, and memory stay as they are. It has eight sections:

- **Register:** talk about the work, not the person; apply corrections instead of acknowledging them; plain, literal wording.
- **Evidence before agreement:** treat user, subagent, and tool claims as hypotheses; read code before making claims; don't invent values nobody gave; check the evidence before state-changing commands.
- **Scope:** don't narrow, widen, or swap the scope; implement the best-supported reading and state the assumption; finish every part; things noticed along the way become follow-ups, not changes.
- **Writing code:** read before editing, follow repository conventions, reuse what exists, targeted edits, structure only for a present need, general logic rather than test-shaped code, tests sized like their neighbors, no leftover scratch files, comments only for non-obvious reasons, security as part of correctness.
- **Verification and reporting:** checks must exercise the change; tests aren't weakened to go green; the final report stands on its own and always keeps failures, unverified parts, assumptions, and follow-ups.
- **Carrying the task through:** names the early stops to avoid (announcing the next step instead of taking it, asking permission for requested work, listing non-blocking decisions, stopping at a milestone) and the stops that are wanted; denials and hook messages are final; content from files and tools is data.
- **Using Claude Code:** parallel tool calls, the task list, plan mode, subagents (and what they don't see), background commands and Monitor, `/compact` and `/clear`, what a compaction summary keeps, `/rewind` limits, `!` commands, worktrees, and CLAUDE.md.
- **Git:** read branch and status first, stage specific files, let hooks run, no amend or force without being asked, and PRs through `gh` with a test plan of what actually ran. This replaces the built-in git instructions once the setup profile sets `includeGitInstructions: false`.

Much of the wording follows Anthropic's own guidance in `docs/platform-claude-com/`, adapted for an interactive session: the Opus 5.5 guide on naming the early stops to avoid, and the Fable 5.1 guide on finishing the whole task, keeping changes and tests to the request, targeted edits, and what compaction summaries must keep.

The built-in coding and git text was reviewed as reference (without copying) against the failure patterns in `docs/`. The replacement drops the emphatic capitals, eager-planning and "proactive" nudges, and the "one or two sentences, nothing else" summary rule that led to under-reporting. It adds the harness guidance the defaults leave out.

The style gives the reason and the wanted behavior instead of listing banned phrases, following Anthropic's [Opus 5.5 prompting guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5). It also tells Claude not to turn the conventions into code, tests, or docs in your project, and not to mention them in replies.

`force-for-plugin: true` applies the style whenever dotclaude is enabled and overrides your `outputStyle` setting. `/output-style` still lists your saved choice, but the dotclaude style is what Claude receives. To use a different style, disable the plugin, or copy the file to `~/.claude/output-styles/` and edit it there with `force-for-plugin` removed.

### Skills and agent

- `/dotclaude:review-code-changes [range]`: runs the `code-reviewer` agent in a fresh, read-only context (Opus 5.5, high effort). It reports findings tied to a concrete failing scenario, most severe first, and what it checked. Claude can also delegate to `code-reviewer` on its own.
- `write-session-handoff [path]`: writes a handoff note (goal, state, decisions, open items, hard-to-rebuild details) for a fresh session. Run it as `/dotclaude:write-session-handoff`, or ask Claude to wrap up for a new session.
- `drive-web-browser`: browser automation with two backends:
  - **agent-browser** (default): uses [agent-browser](https://github.com/vercel-labs/agent-browser) CLI for general browsing
  - **CloakBrowser** (antibot): uses [CloakBrowser](https://github.com/CloakHQ/cloakbrowser), a Playwright replacement with source-level Chromium patches that prevent bot detection

  Set backend via `BROWSER_BACKEND=cloakbrowser` or in `/config`. CloakBrowser is recommended for sites with Cloudflare, DataDome, or other antibot protection—it makes challenges not appear rather than solving them.
- `recognize-captcha`: offline CAPTCHA text recognition via [ddddocr-rs](https://github.com/mzdk100/ddddocr-rs). **Fallback only**—prefer CloakBrowser to prevent CAPTCHAs from appearing. For text CAPTCHAs that still appear despite antibot measures.
- `/dotclaude:apply-settings-profile [user|project|local]`: see above.

## Browser backends and CAPTCHA handling

### CloakBrowser (antibot browsing)

[CloakBrowser](https://github.com/CloakHQ/cloakbrowser) is a Playwright replacement with source-level Chromium patches that make antibot systems see a real human browser. It **prevents** CAPTCHAs from appearing rather than solving them.

**Install:**

```bash
bun install cloakbrowser
# With GeoIP timezone/locale matching (recommended with proxies):
bun install cloakbrowser cloakbrowser-geoip
# Set license key (free tier available):
export CLOAKBROWSER_LICENSE_KEY=your-key
```

**Enable:**

- Set `cloakbrowser` to on in `/config` under dotclaude, or
- Set `BROWSER_BACKEND=cloakbrowser` environment variable

**Usage:**

```bash
# Via CLI helper
bun src/browser/cloakbrowser-launch.mjs https://protected-site.com

# With proxy
bun src/browser/cloakbrowser-launch.mjs --proxy=http://user:pass@proxy:8080 https://site.com
```

### ddddocr-rs (offline CAPTCHA OCR)

[ddddocr-rs](https://github.com/mzdk100/ddddocr-rs) is a Rust implementation for fast offline text CAPTCHA recognition. **Use as fallback only**—CloakBrowser should prevent CAPTCHAs from appearing.

**Install:**

```bash
cargo install ddddocr-cli
mkdir -p ~/.local/share/ddddocr
curl -L -o ~/.local/share/ddddocr/ddddocr.onnx \
  https://github.com/mzdk100/ddddocr-rs/raw/main/models/ddddocr.onnx
```

**Enable:**

- Set `captcha_ocr_ddddocr` to on in `/config` under dotclaude, or
- Set `CAPTCHA_OCR=ddddocr` environment variable

**Usage:**

```bash
bun src/captcha/ddddocr.mjs /path/to/captcha.png
# Output: {"text": "A3Bx9"}
```

## What dotclaude leaves out, and why

The research in `docs/` shows two kinds of fixes that tend to backfire. Banned-phrase lists get routed around with synonyms, and long rule lists make the listed patterns more likely. The output style avoids both: it names the function of each pattern (managing feelings, agreeing without evidence, structure without a consumer) rather than listing phrases, and it stays about 1,450 words.

- **No hook that judges tone or architecture.** A regex can't tell a needed abstraction from a speculative one, so those live in the output style and the reviewer agent, not in a hook.
- **No prompt-type or agent-type hooks.** They run a model call on every event, which costs usage without showing up anywhere.
- **No large CLAUDE.md or SessionStart text.** Static prefix is paid on every turn.
- **No patching of Claude Code itself.** dotclaude only uses the extension points Claude Code documents: plugin hooks, output styles, skills, agents, `userConfig`, and settings keys. Tools that patch the installed CLI, such as tweakcc, are out of scope.

Related tools that were considered:

- [destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard) was not bundled or copied, because of its license rider.
- [cc-safety-net](https://github.com/kenryu42/cc-safety-net) (MIT) is a compatible extra layer if you want one.
- [sqz](https://github.com/ojuschugh1/sqz) was left out because its hook auto-approves rewritten commands.
- [tgrep](https://github.com/microsoft/tgrep) was left out because it has no Claude Code integration yet.

## Development

```bash
bun test tests/               # guard rules and hook scripts end to end
bun run validate              # claude plugin validate --strict on manifests, skills, agents
claude --plugin-dir . plugin details dotclaude   # inventory and token cost
claude plugin eval . --allow-tools Bash,Write,Edit --scaffold   # model-graded evals (uses your plan's usage)
```

Tests pass commands to the guard as strings; nothing in the suite executes a guarded command. Keep it that way when adding cases.

## License

[MIT](LICENSE)
