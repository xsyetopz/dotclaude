# dotclaude Dossier: Open Items

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

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

## 9. Claims Not Acted On

- **Two Max 5x plans against one Max 20x.** One user reports that Max 20x
  gives about 1.7 times the weekly usage of Max 5x. Anthropic does not state
  a weekly ratio. `claude_plan` reads one plan.
- **Auto mode's classifier sends the whole transcript on every Bash call.**
  Not checked in the binary.
- **A Haiku ping keeps the cache warm.** Caches are per model, so a Haiku
  request cannot keep an Opus or Fable cache warm.
- **A cold cache costs 10 times more on Opus and 40 times on Fable.** The
  official cache prices do not produce these ratios.
