# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

## [0.19.0] - 2026-10-03

### Added

- A `DesignSync` call that changes a Claude Design project asks you first, unless the session started the `/design-sync` skill.
  The tool description requires that skill, and a 0.18.1 session uploaded files without it.
  The read methods pass.
  `guard_bash` controls it.
- Two working rules: edit files with `Edit` or `Write` and not with shell scripts, and follow the limits that a tool description gives.
  A skill or command is named only when it is in the session's skill list.
- The Bash guard asks before infrastructure commands that destroy resources or apply changes with no review,
  for example `terraform destroy`, `terraform apply -auto-approve`, `pulumi destroy`, `cdk destroy`, `kubectl delete`, `helm uninstall`, `aws s3 rm --recursive`, `gcloud … delete`, `az … delete`, and `fly apps destroy`.
  The reason names the target when a file shows it, such as the kubeconfig context, `AWS_PROFILE`, or the Terraform workspace.
- The Bash guard asks before a command adds a new dependency, such as `npm install <name>`, `pip install <name>`, `uv add`, `cargo add`, or `go get`.
  The reason names each package and asks Claude to check that it exists and that the task needs it.
  A bare install, a requirements file, an editable install, and a lockfile install pass.
- The Bash guard asks before a command turns off TLS checks,
  for example `curl -k`, `wget --no-check-certificate`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `GIT_SSL_NO_VERIFY`, `git config http.sslVerify false`, and `pip --trusted-host`.
- The Bash guard asks before `rm` or `git rm` deletes a tracked test file, and before `mv` moves it.
- The database reset ask also covers `prisma db push --accept-data-loss` and `drizzle-kit push --force`.
- The Edit guard asks when an edit adds a proof escape in a `.lean`, `.v`, `.thy`, `.agda`, or `.idr` file,
  for example `sorry`, `admit`, `Admitted`, `axiom`, `postulate`, or `native_decide`.
- The Edit guard asks when an edit turns off TLS checks in code,
  for example `verify=False`, `rejectUnauthorized: false`, or `InsecureSkipVerify: true`.
- The verification gate counts more check forms, for example `lake build`, `coqc`, `verilator --lint-only`, `yosys`, `pio test`, `idf.py build`, `west build`, `dbt test`, `sqlfluff lint`, `jupyter nbconvert --execute`, and `godot --headless`.
- `scripts/usage-report.mjs` prints the delegation share: subagent runs per 100 main turns, runs by agent type, and the tool-result tokens that enter the main context per session.
  It also lists the latest subagent runs with their cost and the first line of their hand-back, and the `--runs` flag sets how many.
- Option `context_compaction_handoff` (on by default): before a main-conversation compaction, the main model writes a handoff note.
  dotclaude saves it under `.claude/handoffs/` and adds it to the compacted conversation.
  If the model gives no note in 60 seconds, the compaction runs without it.
- Option `notify_desktop` (on by default): a desktop notification when the main agent ends a turn,
  when Claude asks a question, and when Claude Code asks for a permission.
  The new `Notification` hook `notification/notify-permission.mjs` sends the permission notice.
  It shows the task, the short session ID, and the repository, through `terminal-notifier` or `osascript`.
  A notice with no answer gets one reminder after 5 minutes.
  A question gets one notification, and a turn that you stop with Esc gets none.
  When neither sender exists, nothing shows and nothing fails.
- When you approve one ask for a test edit (removed assertions or a skip marker), the other test-edit asks pass until your next message.
  A deleted or moved test file is a separate kind, with its own approval.
  A denied ask records nothing.
  The new action `user-prompt-submit/clear-ask-approvals.mjs` ends the approval at your next message.
  Task notifications do not end it.
- Option `context_auto_clear` (on by default): from 100k tokens of main context, your next typed prompt saves a handoff note, runs `/clear`, and comes back as your prompt.
  The `SessionStart(clear)` hook adds the full note, so the work continues from it.
  If the note fails, the prompt goes on with no clear.
  The status line shows `clear` in red from that size.
  With the option off, the context note asks Claude for a handoff, as before.

### Changed

- The verification gate sorts each check into `run` (tests, build, type check) or `static` (lint, format, analyzers).
  After a code edit, a `static` check alone does not satisfy the gate or the task gate when the project has a test command.
  A failed `run` check stays reported until a later `run` check passes, also when a lint run passes after it.
- The working rules are rewritten.
  New rules for investigation: check a correction against the evidence, treat a cause that the user suggests as a hypothesis, change nothing when a reproduction shows no defect, and take constants from a source.
  New rules for code: reuse existing mechanisms, keep compatibility only for a named consumer, label substitutes, check the named outcome, and fix a failing check at its cause.
  The final report names workarounds, substitutes, and the level that each check reached.
- The subagent rule now routes work to agents.
  Before, it kept work in the main conversation, and the main agent did almost all work itself.
  The agent descriptions now say when to delegate.
- The `reviewer` reads staged changes, flags weakened checks and packages that do not exist, and has a new `comments` lens for pull request review comments.
- The `web-researcher` quotes the passage that it cites and searches for sources that contradict the claim.
- The `reverse-engineer` marks a value that it did not recover as unknown.
- The `slices` skill checks a finding at its `path:line` before a fix agent starts.
- The Bash guard reads quotes, heredocs, and command substitutions in one pass.
  Before, three scanners with different quote rules let these commands pass with no finding:
  a command after a here-string `<<<`, a `$(...)` inside double quotes, a quoted `{` that split a `git push --force`, and a `$(...)` in an unquoted heredoc body.
  These forms also get a finding now:
  a heredoc `<<` inside `((...))`, a `case` pattern `)` inside `$(...)`, an unquoted `{` after a command name, `$'\x72'` and octal escapes, a shell option value before `-c`, and nesting past the parse limit.
- One list of interpreters, which includes versioned names such as `python3.12`, controls the scan of inline code.
  The guard reads the code only from `-e`, `-c`, or `--eval`, and it also scans a heredoc that goes to `python3 -` or `node -`.
- `uv run`, `uvx`, `uv tool run`, `poetry run`, `pdm run`, and `pipenv run` are wrappers,
  so the guard checks the command that they start, also after global flags such as `uv --directory x run`.
- The verification gate counts a run of the project's own test command as a check.
- The verification gate counts workspace and toolchain forms as checks,
  for example `pnpm -r test`, `npm --prefix app run build`, `yarn workspace web test`, `cargo +nightly test`, and `deno task test`.
- A check command that shows help, a version, or a list, skips the run, or changes files does not count as a check.
  Examples are `pytest --collect-only`, `cargo test --no-run`, `make -n test`, `eslint --fix`, `ruff format`, and `npm run lint:fix`.
- Check detection is in `hooks/lib/_check-command.mjs` and covers the usual check tools of each ecosystem,
  for example Python, JavaScript, Rust, Go, the JVM, Swift, .NET, C and C++, Ruby, PHP, Elixir, Haskell, Dart, Lua, shell, Nix, and infrastructure tools.
  A formatter counts only in its check form, such as `prettier --check`, `gofmt -l`, or `black --check`.
- The verification gate reads the task names of task runners,
  for example `turbo run test`, `nx run-many -t test`, `nx run web:lint`, `moon run :test`, `mise run lint`, `rake spec`, `./gradlew :app:jvmTest`, and `mvn verify`.
  A task name that only fixes or formats, such as `lint:fix` or `spotlessApply`, does not count.
  `npm ci` does not count.
- The verification gate reads the command inside a launcher,
  for example `npx`, `bunx`, `pnpm dlx`, `bundle exec`, `rustup run`, `conda run`, `nix develop -c`, `docker run`, `docker compose run`, `python -m`, and `c8`.
- `--dry-run` is a no-check flag only for tools that skip the run with it, such as `make`, `just`, `gradle`, `turbo`, `mocha`, and `rspec`.
  For a formatter, `--dry-run` is the check.
- An ignore-bypass search that would walk large ignored directories gets a deny reason that keeps the flag and asks for named or excluded directories.
- `git push --force-with-lease` asks with a reason that names the lease.
- `scripts/usage-report.mjs` reads the context bound from `MAIN_CONTEXT_TOKENS`.

### Removed

- The Edit and Bash guards no longer drop the assertion ask when the last prompt asks to remove tests.
  A regex on the words of the prompt decided that, and it fails on other wordings and other languages.
  The ask now stays, and one approval covers the other asks of its kind until your next message.
  `io.session.lastPrompt` had no other caller, so it is removed too.
- The fast-compact integration (Jev by TypeSafe).
  Users report that Jev compacts badly, and the dotclaude eval found its picks no better than keeping the newest outputs.
  `/dotclaude:setup` no longer offers, installs, configures, or reports it.

### Fixed

- The nested-instructions hook stops at the root of a git worktree.
  In `.claude/worktrees/*`, it loaded the main `CLAUDE.md` again, 192 times in 193 runs.
- With `DOTCLAUDE_DEBUG` set, an action error in the module engine reaches Claude Code.
  Without it, the action is skipped as before, because an engine hook error skips all of dotclaude for the event.
- Inline code that starts a shell command as an argument list got no finding,
  for example `subprocess.run(['rm', '-rf', '/'])` or `system("rm", "-rf", "/")`.
  The guard now also checks each comma-separated run of string literals as one command, backtick bodies, Perl `qx` and `qw`, Ruby `%x` and `%w`, and AppleScript `do shell script`.
- `scripts/sandbox.mjs` removed each `DOTCLAUDE_` variable, also one that you set on the command line, such as `DOTCLAUDE_DEBUG`.

## Older Releases

| Series | Releases |
| --- | --- |
| [0.18](docs/changelog/0.18.md) | 0.18.1, [0.18.0](docs/changelog/0.18.0.md) |
| [0.17](docs/changelog/0.17.md) | 0.17.1, [0.17.0](docs/changelog/0.17.0.md) |
| [0.16](docs/changelog/0.16.md) | 0.16.1, 0.16.0 |
| [0.15](docs/changelog/0.15.md) | 0.15.1, 0.15.0 |
| [0.14](docs/changelog/0.14.md) | 0.14.1, 0.14.0 |
| [0.13](docs/changelog/0.13.md) | 0.13.1, 0.13.0 |
| [0.12](docs/changelog/0.12.md) | 0.12.1, 0.12.0 |
| [0.11](docs/changelog/0.11.md) | 0.11.1, 0.11.0 |
| [0.10](docs/changelog/0.10.md) | 0.10.2, 0.10.1, 0.10.0 |
| [0.9](docs/changelog/0.9.md) | 0.9.0 |
| [0.8](docs/changelog/0.8.md) | 0.8.2, 0.8.1, 0.8.0 |
| [0.7](docs/changelog/0.7.md) | 0.7.0 |
| [0.6](docs/changelog/0.6.md) | 0.6.2, 0.6.1, 0.6.0 |
| [0.5](docs/changelog/0.5.md) | 0.5.1, 0.5.0 |
| [0.4](docs/changelog/0.4.md) | 0.4.0 |
| [0.3](docs/changelog/0.3.md) | 0.3.0 |
| [0.1 and 0.2](docs/changelog/0.1-0.2.md) | 0.2.0, 0.1.0 |

[unreleased]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.19.0...HEAD
