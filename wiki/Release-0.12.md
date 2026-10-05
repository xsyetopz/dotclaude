# Release 0.12

Release 0.12 added many guards and checks to the hooks.
It also added a `reverse-engineer` agent and Ghidra setup, and made the status line more compact.
The guards close gaps that usage data showed: unchecked edits, repeated reads, and commands that never end.
After updating, restart Claude Code and run `/dotclaude:apply-settings-profile` again.
The profile now allows 5 agents at once and adds compact instructions to the global `CLAUDE.md` section.
It keeps the values that the user set, but an agent cap of `3` becomes `5`, because 0.11.1 wrote that value.
A version in parentheses marks a change from a later patch of this line.
An entry with no version comes from 0.12.0.

## Added

- Stop gate checks.
  - The gate also runs when Claude marks a task completed.
    After a code edit with no check run after it, the gate keeps the task open once.
    It tells Claude to run the tests, build, or lint.
    The `stop_gate` option turns this off too.
  - The gate sends Claude back once when the last paragraph of its reply announces the next step or offers work.
    Examples are "Next I'll ..." or "Should I ...?".
    Claude then does the work, or ends the turn again when only the user can decide.
    A step that is public or hard to reverse, such as a push or a release, passes.
    A turn that `AskUserQuestion` ended also passes.
  - Each `TaskCompleted` call adds a `task` line to `verdicts.jsonl` with the names of its input fields, because the hooks docs do not pin that input yet.
- Verdict log.
  The Bash guard and the edit guard write each deny and ask to `verdicts.jsonl` in the plugin data directory.
  Each entry is one JSON line, with the target cut to 200 characters.
  The log shows which rules fire too often.
  It moves to `verdicts.1.jsonl` above about 1 MB.
- Approval memory.
  When the user approves an ask and the tool runs, the guards do not ask again in that session.
  This applies to the same command, or the same edit, with the same reason.
  The guard then makes no decision, so the permission rules of the user still apply.
  A deny is never remembered.
- New Bash guard rules.
  - It denies a full re-read of a file that the same agent already read in full, when the file did not change.
    This covers a plain `cat`, a `Read` after a `cat`, and a `cat` after a `Read`.
    Claude Code already skips a `Read` after a `Read`.
    A partial `Read`, a piped `cat`, and a read after compaction pass.
  - It denies a foreground command that does not end by itself or runs for a long time.
    Examples are a `dev`, `serve`, or `watch` script, `--watch`, `tail -f`, and Ghidra `analyzeHeadless`.
    The reason says to run the same command with `run_in_background`.
    A shell `&` or a `timeout` wrapper passes.
  - It asks before `git add` stages a file with an ELF, Mach-O, or PE header, because a committed binary stays in the history.
- Usage notes.
  On the third correction in a row, a note suggests a rewind to before the failed attempts, or a handoff and `/clear`.
  After a reply that stopped with a refusal, a note says to start a new session, because the refusal stays in the context.
  On the third identical Bash command in a row with identical output in one agent, a note says to change the approach.
  It can also say to wait with `Monitor`.
  The `usage_notes` option turns them off.
- Agent limits.
  A subagent that `SendMessage` resumes gets no second copy of the working conventions.
  Claude Code fires `SubagentStart` again on a resume ([#80489](https://github.com/anthropics/claude-code/issues/80489)), and the agent already has the text.
  With 5 subagents running, the guard denies an `Agent` call before Claude Code refuses it.
  The reason tells Claude to wait for a report and then send the next wave.
  The count comes from `SubagentStart` and `SubagentStop`.
  An agent with no activity for 10 minutes no longer counts, because an interrupted agent can end without `SubagentStop`.
  The `subagent_guidance` option turns this off.
- The global `CLAUDE.md` section of the settings profile has a `# Compact instructions` section.
  It tells the compaction summary to keep three things.
  They are the requests of the user in their own words, decisions with their reasons, and exact paths, commands, and errors.
- Ghidra support.
  - `/dotclaude:setup-integrations` registers the MCP server `pyghidra-mcp` in the reverse-engineering project only, and installs the `ghidra-bridge` CLI as the fallback.
    The status reports `uvx`, Python 3.10 or newer, `GHIDRA_INSTALL_DIR` with `analyzeHeadless`, Java 21, the `ghidra` MCP entry, and the CLI.
  - A `reverse-engineer` agent on Opus 5.5 with effort `high` analyzes a binary, protocol, or file format with Ghidra.
    It uses the `ghidra` MCP tools first and the `ghidra-bridge` CLI only when they are missing or fail, and its report names the path.
    For matching work, it pins the SHA-256 of the input, compares bytes and relocations, and keeps an iteration log.
    It does not analyze the Claude Code binary.
- `scripts/usage-report.mjs` reports more.
  - It counts the main sessions by entrypoint (`cli`, `claude-vscode`, `sdk-cli`, `sdk-py`) and the usage-limit hits.
    It also counts the `Skill` calls by skill, and the guard verdicts per rule from `verdicts.jsonl`.
    `--verdicts FILE` reads a different verdict log.
  - It reports the cache write on the first call after a prompt while the cache is warm (`firstCallAfterPrompt`).
    It reports it with and without hook context in the history.
    On one week of sessions, the write was 2.2% of the context with hook context and 1.6% without.
    So hook context did not rewrite the cached prefix ([#83913](https://github.com/anthropics/claude-code/issues/83913)).
  - It counts the dotclaude agent runs that reached their turn-limit reserve.
    For each agent type, it gives the median files and list items in the brief of those runs and of the other runs.
    On one week, most capped briefs named one behavior, and long runs passed the 100k context bound near turn 20.
    So the `implementer` limit stays 80.
- The 5-hour and weekly limits on the status line show their pace, as CodexBar does.
  `▲12%→12:46` is a deficit: usage runs 12 points ahead of an even rate, and at this rate the limit is used up at 12:46.
  `▼30%` is a reserve.
  The pace shows after 3% of the window is gone.

## Changed

- The main status line is more compact (0.12.0, 0.12.1).
  One-column glyphs replace words.
  `⎇` is the branch, `⊞` the worktree, `◷` and `◌` a warm and cold cache, `✗` cache misses, and `▲` and `▼` a limit deficit and reserve.
  A space follows the branch, worktree, and cache glyphs, so the glyph and the text after it do not run together.
  The warm cache shows the minutes until it expires, not the clock time.
  The context bar has 5 cells, not 8.
- The status line does not count a cache miss after a model switch, because a new model starts a new cache.
  Claude Code already keeps the first call and the call after a compaction out of its miss count.
  `scripts/usage-report.mjs` counts full cache rewrites on the first call, after a compaction, and after a model switch as expected, apart from the rewrites that nothing explains.
- The settings profile and the usage bounds allow 5 agents at once, not 3.
  Five is the community figure, and a cap of 3 caused 50 of 77 measured `Agent` errors.
  When the user applies the profile, a value of `3` that 0.11.1 wrote becomes `5`, and any other value stays.
  0.12.0 removes and renames no profile value.
  A test applies the profile to a real 0.11.1 output.

## Fixed

- Files that a Bash command writes now get the same checks as the `Edit` and `Write` tools.
  Before, `cat > tests/a.test.mjs <<'EOF'` could remove every assertion, and a heredoc could write broken YAML frontmatter, with no question.
  The checks cover redirects, `tee`, `sed -i`, `sd`, `cp`, `mv`, and file writes in inline interpreter code.
  A new file under a build directory does not get the generated-file warning.
  The `edit_guard` option turns these checks off.
- The Bash guard asks before snapshot updates through a package script, such as `npm test -- -u` or `pnpm test -u`.
  Before, only direct runner calls asked.
  The reason tells Claude to find the cause of a failing test before it updates the snapshots.
- The stop gate counts a Python write through a `Path` variable as an edit.
  An example is `p = pathlib.Path("src/a.cs")` and then `p.write_text(s)`.
  Before, Claude could edit code this way and stop with no check run.
- The Bash guard expands a glob in a search path, as the shell does, before it looks for ignored directories.
  Before, `grep -rn x docs/*.md` was denied because `docs/` has ignored directories, although the glob names only files.
  `grep -r x *` is still denied when `*` matches an ignored directory.
- The Bash guard resolves paths after `cd ~/dir` against the home directory.
  Before, `cd ~/.claude/projects && find .` was checked as if it ran in the project, and the guard denied it for the ignored directories of the project.
  After `cd $DIR`, the guard treats the directory as unknown and does not guess the project root.
- The Bash guard no longer treats a backtick in Python, Node, Bun, or Deno code as a shell command.
  Before, a Python heredoc that wrote Markdown with code spans, such as a CHANGELOG entry, could be denied.
  The guard checked its strings one by one as shell commands.
  Backticks still count in Perl, Ruby, and PHP, where they run a shell.

Previous: [Release 0.11](Release-0.11) · Next: [Release 0.13](Release-0.13)
