# Usage Habits

Part of the [dotclaude documentation](README.md).
These habits cost nothing and need no code.
Each one keeps text out of the context, and each later request sends the full context again.
The facts come from the Claude Code 2.1.288 bundle (**binary**) unless a label says otherwise.

## Ask Side Questions With `/btw`

**What:** type `/btw <question>` for a question that the current work does not need.
Claude answers in one reply and uses no tools.

**Why:** the question and the answer go into a separate side history, not into the main conversation.
So later requests do not send them again.
The side question reads the main context from the prompt cache, so it costs about one cache read of that context.

## Rewind Instead Of Correcting

**What:** when a turn goes wrong, press Esc two times or type `/rewind`
(also `/checkpoint` or `/undo`).
Then send a better prompt from the earlier point.

**Why:** a correction keeps the wrong attempt and the correction in the context,
so each later request sends both again.
A rewind removes them.
It can also restore the files to their state at that point.

## Keep `CLAUDE.md` Files Small And Scoped

**What:** keep the root `CLAUDE.md` short.
Put the rules for one directory in a `CLAUDE.md` in that directory.

**Why:** the root file loads into every request.
Claude Code loads a subdirectory's file only when Claude reads a file in that directory,
and the [nested instructions](hooks-context.md#nested-instructions-context_nested_instructions)
hook does the same for reads with Bash.
The [instruction-file lint](hooks-context.md#instruction-file-lint) warns at 150 lines.

## Use `/clear` And A Handoff, Not Many Compactions

**What:** at a natural stop, ask Claude for a handoff note with the `handoff` skill, then type `/clear`.
The new session gets a pointer to the note.

**Why:** a compaction summary paraphrases, and the context grows again after each compaction.
A handoff note holds only the facts that the next step needs,
and the [handoff pointer](hooks-context.md#handoff-pointer-context_handoff_pointer) finds it.

## Choose The Model And The Effort

**What:** use the lowest model and effort that do the task well.
[Models](models.md#effort) gives the bounds that dotclaude sets.

**Why:** a larger model or a higher effort costs more for each token,
and a higher effort writes more thinking tokens.

## Give Large Reads To A Subagent

**What:** give a search, a log, or a test run with long output to a dotclaude agent,
such as `investigator` or `test-runner`.

**Why:** the subagent reads the long output in its own context,
and only its short report comes back to the main conversation.
See [agents and skills](agents-and-skills.md#agents).

## Measure A Compression Tool Before You Use It

**What:** before you install a tool that says it compresses prompts or tool output,
compare `/usage` for the same task with the tool and without it.

**Why:** a smaller message can make Claude do more turns.
In one user test, three of four such tools raised the total token use (**reported**).

## Old Transcripts Cost Nothing

**What:** you do not have to delete old transcripts in `~/.claude/projects/` to save tokens.

**Why:** a new session does not load them.
Only `--resume` and `--continue` load a transcript, and then only that one.
