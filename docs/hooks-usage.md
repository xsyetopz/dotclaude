# Usage Hooks

Part of the [hooks](hooks.md) page of the [dotclaude documentation](README.md).
These hooks keep usage inside the bounds of your plan.

## Usage Bounds (`usage_agent_bounds`, `agent_guidance`)

**What:** refuses a subagent's tool calls past 100k tokens of context (150k
for `reviewer`) or near its
turn limit, so its next action is its report. The work continues in a
fresh agent. Claude cannot spawn `general-purpose` agents, and subagents run
in the foreground. With 5 subagents running, Claude cannot start a sixth.
A subagent report longer than 6,000 characters (10,000 for `reviewer` and `investigator`) is refused once.
The agent then keeps the outcome, the changed files, the check results, the unverified parts, and the open items, and puts long detail in a file.
A second report always passes, so no report is lost.

**Why:** calls with a context over 150k tokens were 74.7% of the measured
cost. `general-purpose` runs were 17.6% of it, in place of the cheaper
dotclaude agents. Claude Code delivers nothing from an agent that it stops at
its turn limit, so the agent must report first. Background agents started 501
of 861 main turns. With the bound at 150k, 34 of 69 `implementer` runs still
passed 100k, and subagent calls from 100k to 150k were 9% of the cost. The
`reviewer` keeps 150k: a review finds defects across files only while the whole
change is in view, a fresh reviewer writes that view to the cache again, and 1
of 14 `code-reviewer` runs reached 150k. Claude Code refuses a start past
its own cap, and that caused 50 of 77 measured `Agent` errors. The guard
denies the start first and tells Claude to wait for a report. See
[enforced bounds](dossier/design.md#2-enforced-bounds)
and [usage evidence](dossier/usage.md).
From 2026-09-29 to 2026-10-03, 184 of 680 reports were longer than 6,000 characters, and the main conversation reads each report again on every later turn.

## Usage Notes (`usage_notes`)

**What:** tells Claude once when the session or weekly limit passes 75% and 90%,
with the reset time. At 75%, Claude writes a handoff with
the `handoff` skill and asks you to run `/clear`. At 90%, when the work does
not fit, Claude writes a handoff and tells you the reset time.
A notification names a limit that stops a turn, its reset time, and
`claude --resume`.

From 100k tokens of main context, with `context_auto_clear` on (the default),
your next typed prompt saves a handoff note, clears the context, and comes back
with the note, see [Optional Features](mods.md#optional-features).
No context note comes then.
With the option off, after four compactions, past 100k tokens of main context,
each prompt (or one tool call in a run with no prompt) gives the context size
and asks for a handoff before the current step ends.
The note does not stop the work.
Claude continues and asks you to run `/clear` at the next natural stop.
Until a compaction, a later prompt gives only the size and does not ask for
the handoff again.
When Claude writes a handoff note before the note comes, that counts as the note, so no note asks for it again.

**Why:** no hook input gives Claude its usage or its context size. A compaction
and a handoff cost the same per turn, but compactions 5 to 8 kept fewer facts
than 1 to 4 ([evals](dossier/evals.md#8-compactions-before-a-handoff)). The
note comes at 100k and compaction at about 117k, and one step can use more than
the 17k between them. Thus the handoff comes first.
`COMPACTIONS_BEFORE_HANDOFF` in `hooks/lib/_budget.mjs` sets the count.

The same option turns on a delegation note.
After 12 read calls in the main conversation (`Read`, `Grep`, `Glob`, and
Bash commands that read) since your last typed prompt, with no `Agent` call,
one note tells Claude to give the rest of the reading to
`dotclaude:investigator` and edits to `dotclaude:implementer`.
An `Agent` call or a typed prompt starts the count again.
Each tool result stays in the main context, and each later call reads it again.
In 1,902 prompts from 2026-09-28 to 2026-10-04, the median was 1 read call
and the 90th percentile was 18.
`DELEGATION_NOTE_READS` in `hooks/lib/_budget.mjs` sets the count.

## Model Lock And Plan Awareness (`model_lock`, `model_plan`)

See [Models](models.md).

## Scratchpad Pruning (`usage_scratchpad_prune_days`, off)

**What:** at session start, deletes Claude Code scratchpads that nobody
touched for the number of days you set.

**Why:** builds left in scratchpads can take gigabytes. It is off by default,
because it deletes files.
