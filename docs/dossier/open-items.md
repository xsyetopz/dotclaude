# dotclaude Dossier: Open Items

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

> **0.20.0 status.** These items date from 0.19. 0.20.0 removed the parts that some of them name.
> Each item below is current, or it says that 0.20.0 closed it.

## 8. Open Items

- Re-run `bun scripts/usage-report.mjs --days 7` after a full week on
  0.12.0. Compare it with [section 3](usage.md).
  The guard verdict table is empty, because no 0.20 hook writes `verdicts.jsonl`.
- Check the shape of a usage-limit hit in a real transcript. The report
  counts an assistant entry with `error` set to `rate_limit`. This shape
  comes from the Claude Code bundle, and no local transcript has one yet.
- Measure a week with compaction at 150k.
  A lower bound saves more per call but compacts more often.
  Compare the cost and the number of compactions with 2026-09-28 to 2026-09-29.
  The 100k subagent bound is a status line display only since 0.20.0, so it needs no measure.
- Write a capability eval suite, blind and frozen before any run. It should
  cover long sessions across a compaction, corrections over several turns,
  large repositories, and terse-answer requests.
- Measure per-turn effort changes in one long-lived process.
- Measure `implementer` on Opus 5.5 against Sonnet 5.5 on the same tasks.
  Anthropic recalibrated Sonnet 5.5's effort levels, so also re-check the
  `low` and `medium` settings of the Sonnet agents. The runs on this machine
  had different tasks (see
  [Model Fit](plans-and-models.md#model-fit)). The ProjectArchitect Bench
  A/B is outside evidence on a different harness with a private hard tier,
  so this item stays open.
- A Bash read of a directory does not load its `CLAUDE.md` or its path-scoped `.claude/rules` files
  ([#90450](https://github.com/anthropics/claude-code/issues/90450)).
  0.20.0 removed `load-nested-instructions`, because Claude Code 2.1.288 loads rules on Write and Edit.
- Check that the verify gate counts a check that runs in the background.
  The gate matches a check word in a compound command, but nobody tested `run_in_background`.
- The compaction handoff (`compaction_handoff`) is on by default.
  Measure it with `scripts/compaction-report.mjs` after use.
  The baseline is 42% to 57% retention ([section 8](evals.md)).

Closed by 0.20.0: the session ledger race, the check of a foreground agent at its turn limit, the move of injected texts into files (`rules.md` and `minimal-code.md` now hold them), and the measure of the 0.19.0 working rules.

## 9. Claims Not Acted On

- **Two Max 5x plans against one Max 20x.** One user reports that Max 20x
  gives about 1.7 times the weekly usage of Max 5x. Anthropic does not state
  a weekly ratio. dotclaude reads one plan (`hooks/lib/_plan.mjs`).
- **Auto mode's classifier sends the whole transcript on every Bash call.**
  Not checked in the binary.
- **A Haiku ping keeps the cache warm.** Caches are per model, so a Haiku
  request cannot keep an Opus or Fable cache warm.
- **A cold cache costs 10 times more on Opus and 40 times on Fable.** The
  official cache prices do not produce these ratios.
- **A Sonnet session started 8 Fable agents on extra usage.** One report.
  0.19 denied `Agent(model:fable*)`, and 0.20.0 leaves Fable out of `availableModels`.
- **Opus 5.5 got worse after launch.** Public trackers do not agree. One
  shows 103.8% of the launch score.
  The Reddit threads of 2026-10-03 in `docs/external/2026-10-03/` report the
  same.
  dotclaude responds with prompt rules in the working rules, not with checks
  on words.
- **A tool-call batching rule saves about 20% of tokens on Opus 5.5.** One
  user measured it, and a stronger wording made reviews worse. Claude Code
  already tells Claude to make independent calls together.
- **Non-Claude model serving** (report parts 04, 05, 23, and 29 of the
  external reports). Quantization, routing, and serving of other vendors'
  models are outside a plugin's reach.
- **Refusals by a safety classifier.** A plugin cannot change the classifier
  of the model or of the engine.
- **DensePack.** A tool that a user built to save usage. No measurement
  shows that it helps, and it compresses text with loss.
- **Domain checklists.** A checklist per field, such as security or
  accessibility. No evidence shows that a checklist raises the pass rate, and
  the reports are not a spec.
