# Release 0.15

Release 0.15 changed when the context note asks Claude for a handoff.
The 0.14 note asked at the first crossing of 100k tokens, so every long session stopped there.
The 0.15 note waits for compactions, and it asks for the handoff before the current step ends.
A version in parentheses marks a change from a later patch of this line.
An entry with no version comes from 0.15.0.

## Changed

- The context note waits for four compactions of the main conversation.
  Before, it asked for a handoff at the first crossing of 100k tokens.
  A compaction and a handoff both start the next part from about 20k tokens, so they cost about the same for each turn.
  In the local transcripts, compactions 1 to 4 kept 49% to 57% of the facts that Claude used next.
  Compactions 5 to 8 kept 42%.
  The note gives the compaction count.
  `COMPACTIONS_BEFORE_HANDOFF` in `hooks/lib/_budget.mjs` sets the count.
- The note asks for the handoff before the current step ends, not after it (0.15.1).
  The note comes at 100k tokens and compaction at about 117k, and one step can use more than the 17k between them.
  In one 0.15.0 session, a fifth compaction came right after the handoff.
  The note now gives the compaction point and says that it does not stop the work.
  In two 0.15.0 sessions, Claude put off new requests from the user after the note.
  In two other sessions it said that the context limit was reached.
  The prompting best practices of Claude also tell Claude not to stop tasks early because of the token budget.
- Only the first context note after a crossing of 100k tokens asks for the handoff (0.15.1).
  A later prompt before the next compaction gets a short note with the size.
  Claude updates the handoff only when the state changed.
  Before, each prompt asked for the handoff again, and in one 0.15.0 session Claude updated the handoff instead of starting a new request.
- The status line measures the main context against 117k, not 150k.
  Claude Code compacts at 117k with the 150k `autoCompactWindow`, and the context never reached 150k.
  `⇊2/4` gives the compactions so far, and `handoff` shows when the context note asks for one.
  To count compactions, each refresh reads only the transcript lines added since the last refresh.
- The session note and the system prompt no longer tell Claude to hand off near 150k tokens.
  With `autoCompactWindow` at 150k, Claude Code compacts at about 117k, so that point never came, and Claude started handoffs on its own estimate.
  Claude now waits for the context note.
- `scripts/compaction-report.mjs` measures the cost and the kept facts of each compaction from the local transcripts.
- The `write-session-handoff` skill records which decision replaced an earlier one, and each request from the user that is not started (0.15.1).
- The hook docs and the README name `claude plugin configure dotclaude@dotclaude` (Claude Code 2.1.285) to list the plugin options.
- The design dossier notes that Claude Code 2.1.285 removed the second reply after a background report, and why forks stay off.

## Fixed

- A check command longer than 200 characters ends with `…` in the Stop message (0.15.1).
  Before, the message cut it with no mark, for example `…; py`.

Previous: [Release 0.14](Release-0.14) · Next: [Release 0.16](Release-0.16)
