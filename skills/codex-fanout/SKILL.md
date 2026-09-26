---
name: codex-fanout
description: Plan and run a batch of bounded tasks on parallel OpenAI Codex GPT-6 Luna workers (the codex-worker agent) within the user's ChatGPT plan quota, with Claude as orchestrator, reviewer, and committer. Use when the user wants Codex to do a large amount of mechanical or well-specified work (a port, a migration, fixing many failing tests or type errors), or asks to fan work out to Codex or Luna.
argument-hint: "[the work to fan out]"
allowed-tools: Bash(bun *status.mjs*)
---

<context>
The user's ChatGPT plan decides what is affordable. `plus` has a 5-hour and a weekly window; `prolite` (Pro 5x) and `pro` (Pro 20x) have only the weekly window. Luna barely moves the quota; Sol is a cheaper middle tier that works best as a tightly briefed delegate; Astra is the strongest reviewer and costs several times more, so it is never used on Plus. Codex workers run in a sandbox where `.git` is read-only, so they cannot commit: you review and commit their work.

Current Codex setup: !`bun "${CLAUDE_SKILL_DIR}/../setup-integrations/scripts/status.mjs" --codex`
</context>

<procedure>
1. If the Codex CLI is missing, not logged in, or the `dotclaude-luna` profile is not installed (see the setup line above), run the `setup-integrations` skill for Codex first.
2. Build the work queue from tool output rather than judgment: compiler or type-checker errors grouped by file, failing tests, or a file list. Each item is one to three files or one failing test, with a stated acceptance command, small enough to finish without Codex compacting its context.
3. Write the shared context once (conventions, the target API, the porting rules) to a file in the repository or scratchpad, and point every brief at it by path, so workers share an identical prompt prefix and hit Codex's cache.
4. Trial two or three items first. Review their diffs and check how far the plan's usage moved before dispatching the rest.
5. Codex records a trust entry in `config.toml` the first time it runs in a directory, and parallel first runs overwrite each other's entries. Before a parallel batch, create any worktrees the batch needs and run the first item in each new directory on its own.
6. Dispatch items as parallel `dotclaude:codex-worker` agents, each with its task, files, acceptance command, and working directory. Start at 2–3 concurrent workers on `plus`, 4 on `prolite`, and up to 6 on `pro`, and give parallel workers disjoint files; items that touch the same files run one after another or in separate `git worktree` checkouts. Stay within the session's subagent cap of 40, and keep the rest of the queue for a later batch.
7. For each finished item, read the diff, run its acceptance command yourself, and commit it by path when it passes. A failed item is retried once with the failure in the brief, then escalated: Luna at `max` effort, then Sol; Astra only on `prolite` or `pro`, and only when both failed or the item needs design judgment.
8. After each batch, run the full test suite once, and review the combined diff (with `dotclaude:codex-reviewer` on high-stakes batches).
9. Stop dispatching when a worker reports a usage-limit error, and tell the user which items remain.
</procedure>

<constraints>
Workers wait on process exit; never ask one to poll or loop, since every idle turn costs quota. Do not pass Codex's sandbox- or hook-bypass flags, and do not switch the service tier. Keep your own context small: take each worker's report, not its log.
</constraints>

Work to fan out: $ARGUMENTS
