# Release 0.19

Release 0.19 added guards for risky infrastructure, dependency, and TLS commands.
It rewrote the working rules to push reading and edits to subagents, and it rebuilt check detection in the verification gate.
It also added a delegation note, desktop notifications, and an automatic handoff and `/clear` at 100k tokens.
A version in parentheses marks a change from a later patch of this line.
An entry with no version comes from 0.19.0.

## Added

- Guards.
  - A `DesignSync` call that changes a Claude Design project asks first, unless the session started the `/design-sync` skill.
    The tool description requires that skill, and a 0.18.1 session uploaded files without it.
    The read methods pass.
    `guard_bash` controls it.
  - The Bash guard asks before infrastructure commands that destroy resources or apply changes with no review.
    Examples are `terraform destroy`, `terraform apply -auto-approve`, `pulumi destroy`, `cdk destroy`, `kubectl delete`, `helm uninstall`, `aws s3 rm --recursive`, `gcloud … delete`, `az … delete`, and `fly apps destroy`.
    The reason names the target when a file shows it, such as the kubeconfig context, `AWS_PROFILE`, or the Terraform workspace.
  - The Bash guard asks before a command adds a new dependency, such as `npm install <name>`, `pip install <name>`, `uv add`, `cargo add`, or `go get`.
    The reason names each package and asks Claude to check that it exists and that the task needs it.
    A bare install, a requirements file, an editable install, and a lockfile install pass.
  - The Bash guard asks before a command turns off TLS checks.
    Examples are `curl -k`, `wget --no-check-certificate`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `GIT_SSL_NO_VERIFY`, `git config http.sslVerify false`, and `pip --trusted-host`.
  - The Bash guard asks before `rm` or `git rm` removes a tracked test file, and before `mv` moves it.
  - The database reset ask also covers `prisma db push --accept-data-loss` and `drizzle-kit push --force`.
  - The Edit guard asks when an edit adds a proof escape in a `.lean`, `.v`, `.thy`, `.agda`, or `.idr` file.
    Examples are `sorry`, `admit`, `Admitted`, `axiom`, `postulate`, or `native_decide`.
  - The Edit guard asks when an edit turns off TLS checks in code, for example `verify=False`, `rejectUnauthorized: false`, or `InsecureSkipVerify: true`.
  - When the user approves one ask for a test edit (removed assertions or a skip marker), the other test-edit asks pass.
    They pass until the next message of the user.
    A removed or moved test file is a separate kind, with its own approval.
    A denied ask records nothing.
    The action `user-prompt-submit/clear-ask-approvals.mjs` ends the approval at the next message of the user.
    Task notifications do not end it.
- Two working rules.
  Claude edits files with `Edit` or `Write` and not with shell scripts, and follows the limits that a tool description gives.
  A skill or command is named only when it is in the skill list of the session.
- The verification gate counts more check forms, for example `lake build`, `coqc`, `verilator --lint-only`, `yosys`, `pio test`, `idf.py build`, `west build`, `dbt test`, `sqlfluff lint`, `jupyter nbconvert --execute`, and `godot --headless`.
- Context options.
  - `context_compaction_handoff` (on by default): before a main-conversation compaction, the main model writes a handoff note.
    dotclaude saves it under `.claude/handoffs/` and adds it to the compacted conversation.
    If the model gives no note in 60 seconds, the compaction runs without it.
  - `context_auto_clear` (on by default): from 100k tokens of main context, the next typed prompt saves a handoff note and runs `/clear`.
    The prompt then comes back as the prompt of the user.
    The `SessionStart(clear)` hook adds the full note, so the work continues from it.
    If the note fails, the prompt goes on with no clear.
    The status line shows `clear` in red from that size.
    With the option off, the context note asks Claude for a handoff, as before.
- `notify_desktop` (on by default) sends a desktop notification in three cases.
  The cases are when the main agent ends a turn, when Claude asks a question, and when Claude Code asks for a permission.
  The new `Notification` hook `notification/notify-permission.mjs` sends the permission notice.
  It shows the task, the short session ID, and the repository, through `terminal-notifier` or `osascript`.
  A notice with no answer gets one reminder after 5 minutes.
  A question gets one notification, and a turn that the user stops with Esc gets none.
  When neither sender exists, nothing shows and nothing fails.
- A delegation note (0.19.1).
  Claude gets one note for each message after 12 read calls in the main conversation.
  The count starts at the last message of the user, and an `Agent` call between the reads resets it.
  A read call is `Read`, `Grep`, `Glob`, or a Bash command that only reads.
  The note says to give the rest of the reading to `dotclaude:investigator` and the edits to `dotclaude:implementer`.
  Each tool result stays in the main context, and each later call reads it again.
  In the transcripts since 2026-09-28, the median message had 1 read call, and 12 is about the 83rd percentile.
  `usage_notes` controls it, and `DELEGATION_NOTE_READS` in `hooks/lib/_budget.mjs` sets the bound.
- `scripts/usage-report.mjs` prints the delegation share.
  It gives subagent runs per 100 main turns, runs by agent type, and the tool-result tokens that enter the main context for each session.
  It also lists the latest subagent runs with their cost and the first line of their hand-back.
  The `--runs` flag sets how many.
- Role evals `t5-investigate` and `t5-web-research`, and the `just eval-agent <model> <effort>` recipe that runs them at a subagent model and effort (0.19.1).

## Changed

- The working rules are rewritten.
  - New rules for investigation: check a correction against the evidence, and treat a cause that the user suggests as a hypothesis.
    Change nothing when a reproduction shows no defect, and take constants from a source.
  - New rules for code: reuse existing mechanisms, and keep compatibility only for a named consumer.
    Label substitutes, check the named outcome, and fix a failing check at its cause.
  - The final report names workarounds, substitutes, and the level that each check reached.
  - The subagent rule routes work to agents.
    Before, it kept work in the main conversation, and the main agent did almost all work itself.
    The agent descriptions now say when to delegate.
    The rule says that the main conversation coordinates (0.19.1).
    It gives the reading of more than a few files, log scans, and multi-file edits to a subagent.
- Agents (0.19.0, 0.19.1).
  - With `model_lock` on, the definition of a dotclaude agent sets its model (0.19.1).
    dotclaude removes a `model` that an `Agent` call gives, and no deny reason names a model to use.
    Before, 175 `implementer` runs used Opus 5.5 because a call set `model: "opus"`.
  - `investigator` and `web-researcher` run on Sonnet 5.5 at `medium`, from Opus 5.5 at `medium` and `low` (0.19.1).
    They mostly read and summarize.
    The cost guidance of Anthropic gives such subagent steps to a cheaper model, with `medium` as the start for multi-step tool use.
    `reverse-engineer` stays on Opus 5.5, because it has no role eval and a wrong reading of machine code is expensive to find later.
  - The `reviewer` reads staged changes, flags weakened checks and packages that do not exist, and has a new `comments` lens for pull request review comments.
  - The `web-researcher` quotes the passage that it cites and searches for sources that contradict the claim.
  - The `reverse-engineer` marks a value that it did not recover as unknown.
  - The `slices` skill checks a finding at its `path:line` before a fix agent starts.
- `/dotclaude:setup` uses CodeGraph through the `codegraph explore` command and removes the `codegraph` MCP server after `codegraph install` (0.19.1).
  The MCP server sends fixed instructions that tell Claude not to give lookups to a subagent, and no setting turns them off.
  Each setup run also removes a `codegraph` MCP server that is registered, for example after `codegraph upgrade` adds it again.
  The agents run `codegraph explore` through Bash, and no agent lists the MCP tool.
- The Bash guard reads quotes, heredocs, and command substitutions in one pass.
  - Before, three scanners with different quote rules let these commands pass with no finding.
    They were a command after a here-string `<<<`, a `$(...)` inside double quotes, and a quoted `{` that split a `git push --force`.
    They were also a `$(...)` in an unquoted heredoc body.
  - These forms also get a finding now.
    They are a heredoc `<<` inside `((...))`, a `case` pattern `)` inside `$(...)`, and an unquoted `{` after a command name.
    They are also `$'\x72'` and octal escapes, a shell option value before `-c`, and nesting past the parse limit.
  - One list of interpreters, which includes versioned names such as `python3.12`, controls the scan of inline code.
    The guard reads the code only from `-e`, `-c`, or `--eval`, and it also scans a heredoc that goes to `python3 -` or `node -`.
  - `uv run`, `uvx`, `uv tool run`, `poetry run`, `pdm run`, and `pipenv run` are wrappers, so the guard checks the command that they start, also after global flags such as `uv --directory x run`.
  - An ignore-bypass search that would walk large ignored directories gets a deny reason that keeps the flag and asks for named or excluded directories.
  - `git push --force-with-lease` asks with a reason that names the lease.
- The verification gate.
  - It sorts each check into `run` (tests, build, type check) or `static` (lint, format, analyzers).
    After a code edit, a `static` check alone does not satisfy the gate or the task gate when the project has a test command.
    A failed `run` check stays reported until a later `run` check passes, also when a lint run passes after it.
  - It counts a run of the project own test command as a check.
  - It counts workspace and toolchain forms, for example `pnpm -r test`, `npm --prefix app run build`, `yarn workspace web test`, `cargo +nightly test`, and `deno task test`.
  - It reads the task names of task runners, for example `turbo run test`, `nx run-many -t test`, `nx run web:lint`, `moon run :test`, `mise run lint`, `rake spec`, `./gradlew :app:jvmTest`, and `mvn verify`.
    A task name that only fixes or formats, such as `lint:fix` or `spotlessApply`, does not count.
    `npm ci` does not count.
  - It reads the command inside a launcher, for example `npx`, `bunx`, `pnpm dlx`, `bundle exec`, `rustup run`, `conda run`, `nix develop -c`, `docker run`, `docker compose run`, `python -m`, and `c8`.
  - A command that shows help, a version, or a list, skips the run, or changes files does not count.
    Examples are `pytest --collect-only`, `cargo test --no-run`, `make -n test`, `eslint --fix`, `ruff format`, and `npm run lint:fix`.
  - `--dry-run` is a no-check flag only for tools that skip the run with it, such as `make`, `just`, `gradle`, `turbo`, `mocha`, and `rspec`.
    For a formatter, `--dry-run` is the check.
  - Check detection is in `hooks/lib/_check-command.mjs`.
    It covers the usual check tools of Python, JavaScript, Rust, Go, the JVM, Swift, .NET, C and C++, Ruby, PHP, and Elixir.
    It also covers Haskell, Dart, Lua, shell, Nix, and infrastructure tools.
    A formatter counts only in its check form, such as `prettier --check`, `gofmt -l`, or `black --check`.
- `scripts/usage-report.mjs` reads the context bound from `MAIN_CONTEXT_TOKENS`.

## Removed

- The Edit and Bash guards no longer drop the assertion ask when the last prompt asks to remove tests.
  A regex on the words of the prompt decided that, and it fails on other wordings and other languages.
  The ask now stays, and one approval covers the other asks of its kind until the next message of the user.
  `io.session.lastPrompt` had no other caller, so it is removed too.
- The fast-compact integration (Jev by TypeSafe).
  Users report that Jev compacts badly, and the dotclaude eval found its picks no better than keeping the newest outputs.
  `/dotclaude:setup` no longer offers, installs, configures, or reports it.

## Fixed

- Claude finds the tool call that made a change before it says who made the change (0.19.1).
  Claude says that it does not know when it finds no call.
  Before, the `handoff` skill told Claude to name each other uncommitted change as the work of the user.
  Claude then called a file that it had made "not this session's work", and the next session repeated the claim from the note.
  The working rules, the subagent conventions, and the `handoff` skill have the check.
- The `CLAUDE.md` preview of `/dotclaude:setup` lists the lines that the new block drops, and says that a later dotclaude version removed them on purpose (0.19.1).
  A 0.19.0 session read the `# Compact instructions` section, which 0.18.1 removed, as the text of the user, and it moved the end marker to keep it.
- `/dotclaude:setup` removes that `# Compact instructions` section from `~/.claude/CLAUDE.md` when it sits outside the block as an exact copy of an earlier dotclaude version (0.19.1).
  The compaction hook sends the same priorities, so the section only repeated them.
  A section that the user changed stays.
- The nested-instructions hook stops at the root of a git worktree.
  In `.claude/worktrees/*`, it loaded the main `CLAUDE.md` again, 192 times in 193 runs.
- With `DOTCLAUDE_DEBUG` set, an action error in the module engine reaches Claude Code.
  Without it, the action is skipped as before, because an engine hook error skips all of dotclaude for the event.
- Inline code that starts a shell command as an argument list got no finding, for example `subprocess.run(['rm', '-rf', '/'])` or `system("rm", "-rf", "/")`.
  The guard now also checks each comma-separated run of string literals as one command, backtick bodies, Perl `qx` and `qw`, Ruby `%x` and `%w`, and AppleScript `do shell script`.
- `scripts/sandbox.mjs` removed each `DOTCLAUDE_` variable, also one that the user set on the command line, such as `DOTCLAUDE_DEBUG`.

Previous: [Release 0.18](Release-0.18) · Next: [Current changelog](https://github.com/xsyetopz/dotclaude/blob/main/CHANGELOG.md)
