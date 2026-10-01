---
name: slices
description: Runs a large migration, port, or rewrite that tests cover as reviewed slices with a frozen test oracle. Use for changes across many files. Not for a few files.
argument-hint: "[the change, for example: port src/parser to Rust]"
---

<context>
Three large ports used the same workflow: Bun from Zig to Rust, the GitHub Copilot runtime from TypeScript to Rust, and pnpm v12. Each one wrote a guide first. Each one cut the work into small slices, leaves first. Each one kept the existing tests frozen as the oracle, and each one let a separate reviewer read each diff. This skill applies that workflow with dotclaude's agents. dotclaude hooks enforce two parts: a subagent cannot change a protected oracle file, and a slice with the status `implemented` and no review stops the turn once.
</context>

<procedure>
<setup>
Do these steps in the main conversation, before you start an agent. Write each loop file with the `Write` tool, not with a shell command, because the user can review a `Write` call more easily.

1. Find the oracle: the test command that covers the change, and the test files. Run the command once. If it fails before the change, tell the user and stop, because a failing oracle cannot show that a slice is correct.
2. Write `.dotclaude/loop/GUIDE.md`, 150 lines or fewer:
   - **Goal**: the user's request in the user's words.
   - **Invariants**: the rules that each slice keeps, for example "the public API does not change" or "no new dependency".
   - **Idiom map**: each old pattern and its new form, one line each, with a short example.
   - **Oracle**: the command, and what a pass looks like.
   - **Out of scope**: the parts that no slice changes.
3. Write `.dotclaude/loop/loop.json`: `{"oracle": "<command>", "protected": ["<glob>", ...]}`. The globs are relative to the project root, for example `tests/**`. While this file exists, the edit guard and the Bash guard deny a subagent's change to a matching file.
4. Write `.dotclaude/loop/slices.jsonl`, one JSON object on each line: `{"id", "title", "files", "deps", "risk", "status"}`.
   - Start with the leaves: the slices that no other slice depends on. `deps` lists the IDs that must merge first.
   - Give each slice one behavior and at most 5 files. From 2026-09-25 to 2026-09-29, `implementer` briefs that named more than 5 files reached the turn limit in 38.8% of runs, and briefs with 5 files or fewer in 26.9%.
   - Each slice removes the old path that it replaces. Two paths for one behavior double the review.
   - Set `risk` to `high` for a slice that changes a public interface, concurrency, security, or persisted data. Otherwise set `normal`.
   - Set each `status` to `pending`.
5. Show the user the guide and the slice list, and ask the user to approve the slice list. Start the waves only after the user agrees, because a wrong cut costs every later slice. The user asked for a loop. If the change looks too small for a loop, say so in one sentence, but still ask the user to approve the slice list. Do not offer a direct change as an option in the same question.

Add `.dotclaude/` to `.git/info/exclude`, so that the loop files stay out of commits.
</setup>

<wave>
A wave is the set of `pending` slices whose `deps` are all `merged`. Run at most 5 slices in one wave, because dotclaude refuses a sixth agent at the same time. Send all `Agent` calls of one step in one message, so that they run at the same time.

For each slice of the wave:

1. **Implement.** Start `implementer` with `isolation: "worktree"`. Use the brief below. Set the status to `implemented` when it reports.
2. **Review.** Start `reviewer` with the `diff` lens, the git range of the slice, and the path of the guide. Do not give it the implementer's report. For a `risk: high` slice, also start a second `reviewer` with the `code` lens in the same message, so that two independent reviews read the diff.
3. **Fix.** When a reviewer reports a blocking or should-fix finding, start a new `implementer` in the same worktree with the diff and the findings. A new agent does not share the first agent's assumptions. After two fix rounds, set the status to `failed` and tell the user.
4. **Check.** Run the oracle command in the worktree. A pass is required.
5. **Merge.** Set the status to `reviewed`. Merge the worktree branch into the working branch. Run the oracle again on the working branch, because two slices can conflict. Then set the status to `merged`.

After each wave, give the user one line for each slice: its ID, its status, and the oracle result. The status line shows `loop <merged>/<total>`.
</wave>

<finish>
When all slices are `merged`, run the full oracle and the project's lint or build. Then start one `reviewer` with the `code` lens on the whole diff from the start of the loop. Report the result to the user. Delete `.dotclaude/loop/` only when the user agrees, because it records the decisions of the run.
</finish>
</procedure>

<brief>
Give each `implementer` this brief, and fill in the parts in angle brackets:

```text
Slice <id>: <title>.
Read .dotclaude/loop/GUIDE.md first. It gives the invariants and the idiom map.
Files: <files>. Change only these files.
Behavior: <the one behavior that this slice changes>.
Remove the old path: <the old code that this slice replaces>.
Oracle: <command>. It must pass. You cannot change the files that match <globs>. If the oracle itself looks wrong, stop and say so in your report.
Run each command from your worktree root, as a plain command. Claude Code refuses a command in a worktree agent when it cannot show that the command stays in the worktree: `bash -c`, `eval`, a shell variable or a brace expansion in an argument, or a `git` command inside a larger command.
Report: what changed, the oracle result, and anything left open.
```
</brief>

<task>
Run the change in `$ARGUMENTS`, or in the user's last message when `$ARGUMENTS` is empty, as a loop of small slices. Each slice goes through an implementer, a reviewer that sees only the diff, a fixer, and a frozen test oracle.
</task>
