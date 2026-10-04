# dotclaude Dossier: Open Items

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

> **0.20.0 status.** These items date from 0.19. 0.20.0 removed the parts that some of them name (nested instructions, `hand-off-capped-agents.mjs`, the session ledger, the delegation note, `model_plan`, and the 0.19 usage bounds). Treat an item about a removed part as closed.

## 8. Open Items

- Re-run `bun scripts/usage-report.mjs --days 7` after a full week on
  0.12.0. Compare it with [section 3](usage.md), and read the guard
  verdicts per rule to find rules that fire too often.
- Check the shape of a usage-limit hit in a real transcript. The report
  counts an assistant entry with `error` set to `rate_limit`. This shape
  comes from the Claude Code bundle, and no local transcript has one yet.
- Measure one week with `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=1h` from the
  optional profile. Keep it only if the subagent cache writes plus the
  idle misses cost less than in the week before.
- Measure a week at the lower bounds: compaction at 150k and the subagent
  budget at 100k. A lower bound saves more per call but compacts and hands
  off more often, and each new agent reads its files again. Compare the cost
  and the number of handoffs with 2026-09-28 to 2026-09-29.
- Check that a foreground agent stopped at its turn limit still gets a
  handoff. `hand-off-capped-agents.mjs` reads the task notification, which a
  foreground agent may not produce.
- Consider moving the long injected texts into `hooks/prompts/*.md`, with
  placeholders filled from `_budget.mjs`.
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
- Load path-scoped `.claude/rules` files for Bash reads too.
  `load-nested-instructions.mjs` covers only `CLAUDE.md`, `.claude/CLAUDE.md`,
  and `CLAUDE.local.md`
  ([#90450](https://github.com/anthropics/claude-code/issues/90450)).
- Remove the race between the module and the Node hooks on the session
  ledger.
  The module `$.fs` has no rename and no lock, so a module write and a Node
  write in the same step can lose one of the two records.
- Count a check inside a compound or background command.
  The ledger records a check only from a foreground command, and
  `run_in_background` checks arrive after the stop gate reads the ledger.
- Measure whether the 0.19.0 working rules change behavior.
  Compare the delegation share of `bun scripts/usage-report.mjs --days 7`
  after one week with the [baseline](usage.md): 3.8 subagent runs per 100
  main turns.
- The compaction handoff (`context_compaction_handoff`) is on by default.
  Measure it with `scripts/compaction-report.mjs` after use.
  The baseline is 42% to 57% retention ([section 8](evals.md)).

## 9. Claims Not Acted On

- **Two Max 5x plans against one Max 20x.** One user reports that Max 20x
  gives about 1.7 times the weekly usage of Max 5x. Anthropic does not state
  a weekly ratio. `model_plan` reads one plan.
- **Auto mode's classifier sends the whole transcript on every Bash call.**
  Not checked in the binary.
- **A Haiku ping keeps the cache warm.** Caches are per model, so a Haiku
  request cannot keep an Opus or Fable cache warm.
- **A cold cache costs 10 times more on Opus and 40 times on Fable.** The
  official cache prices do not produce these ratios.
- **A Sonnet session started 8 Fable agents on extra usage.** One report.
  dotclaude already denies `Agent(model:fable*)`.
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
