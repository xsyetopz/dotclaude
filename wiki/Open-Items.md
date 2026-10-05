# Open Items

This page answers one question: which measures and claims about dotclaude are still open?
The items date from 0.19.
0.20.0 removed the parts that some of them name.
Each item below is current, or it says that 0.20.0 closed it.
Labels: **reported** means a claim from a user.

## Open measures

- Re-run `bun scripts/usage-report.mjs --days 7` after a full week on 0.12.0.
  Compare it with [Usage evidence](Usage-Evidence).
  The guard verdict table shows only 0.19 rows, because no 0.20 hook writes `verdicts.jsonl`.
- Measure a week with compaction at 150k.
  Since 0.20.0, 32 of 33 compactions fired at 116k to 122k context, and 1.3% of the cost came from calls past 150k (2026-09-29 to 2026-10-05, **measured**).
  The data covers less than 2 days.
  A lower bound saves more per call but compacts more often.
  Compare the cost and the number of compactions with 2026-09-28 to 2026-09-29.
  The 100k subagent bound only shows in the status line since 0.20.0, so it needs no measure.
- Measure the line-break hook for a week.
  Count the `line_breaks` notes, the notes that Claude applies, and the notes on text with correct breaks.
  The 15 to 30 token bounds of `sembr` come from a trial on 3 samples only.
- Write a capability eval suite, blind and frozen before any run.
  It should cover long sessions across a compaction, corrections over several turns, large repositories, and terse-answer requests.
- Measure per-turn effort changes in one long-lived process.
  No data yet: each effort value in the transcripts of 2026-10-04 and 2026-10-05 is `medium`.
- Measure `implementer` on Opus 5.5 against Sonnet 5.5 on the same tasks.
  Anthropic recalibrated the effort levels of Sonnet 5.5, so also re-check the `low` and `medium` settings of the Sonnet agents.
  The runs on this machine had different tasks (see [Model fit](Plans-and-Models#model-fit)).
  The ProjectArchitect Bench A/B is outside evidence on a different harness with a private hard tier, so this item stays open.
- A Bash read of a directory does not load its `CLAUDE.md` or its path-scoped `.claude/rules` files ([#90450](https://github.com/anthropics/claude-code/issues/90450)).
  0.20.0 removed `load-nested-instructions`, because Claude Code 2.1.288 loads rules on Write and Edit.
- The compaction handoff (`compaction_handoff`) is on by default.
  Measure it with `scripts/compaction-report.mjs` after use.
  The baseline is 42% to 57% retention (see [Evals](Evals#compactions-before-a-handoff)).
  The first 5 sessions with a handoff note kept 46% to 54%, inside the baseline.
  On 2026-10-05, Claude wrote 21 handoff notes and continued in the compacted context after each one.
  Since the change after 0.20.8, Claude stops after the note and tells the user to run `/clear`.
  Measure how often the user runs `/clear` after a note.

Closed by 0.20.0:

- the session ledger race
- the check of a foreground agent at its turn limit
- the move of injected texts into files (`rules.md` and `minimal-code.md` now hold them)
- the measure of the 0.19.0 working rules

Closed by the transcripts of 2026-10-04:

- The shape of a usage-limit hit.
  It is an `assistant` entry with `error` set to `rate_limit`, `isApiErrorMessage` set to true, `apiErrorStatus` 429, and the model `<synthetic>`.
  The usage report counts this shape.

## Claims not acted on

- **Two Max 5x plans against one Max 20x.**
  One user reports that Max 20x gives about 1.7 times the weekly usage of Max 5x.
  Anthropic does not state a weekly ratio.
  dotclaude reads one plan (`hooks/lib/_plan.mjs`).
- **Auto mode's classifier sends the whole transcript on every Bash call.**
  Not checked in the binary.
- **A Haiku ping keeps the cache warm.**
  Caches are per model, so a Haiku request cannot keep an Opus or Fable cache warm.
- **A cold cache costs 10 times more on Opus and 40 times on Fable.**
  The official cache prices do not produce these ratios.
- **A Sonnet session started 8 Fable agents on extra usage.**
  One report.
  0.19 denied `Agent(model:fable*)`, and 0.20.0 leaves Fable out of `availableModels`.
- **Opus 5.5 got worse after its release.**
  Public trackers do not agree.
  One shows 103.8% of the score at release.
  The Reddit threads of 2026-10-03 report the same.
  They are in `external/2026-10-03/`, a local source of the maintainer.
  dotclaude responds with prompt rules in the working rules, not with checks on words.
- **A tool-call batching rule saves about 20% of tokens on Opus 5.5.**
  One user measured it, and a stronger wording made reviews worse.
  Claude Code already tells Claude to make independent calls together.
- **Non-Claude model serving** (parts 04, 05, 23, and 29 of the external reports).
  Quantization, routing, and serving of the models of other vendors are outside the reach of a plugin.
- **Refusals by a safety classifier.**
  A plugin cannot change the classifier of the model or of the engine.
- **DensePack.**
  A tool that a user built to save usage.
  No measurement shows that it helps, and it compresses text with loss.
- **Domain checklists.**
  A checklist per field, such as security or accessibility.
  No evidence shows that a checklist raises the pass rate, and the reports are not a spec.
