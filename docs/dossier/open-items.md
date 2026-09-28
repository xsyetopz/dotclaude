# dotclaude Dossier: Open Items

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

## 8. Open Items

- Re-run `bun scripts/usage-report.mjs --days 7` after a full week on the
  0.7.0 defaults. Compare it with [section 3](usage.md).
- Decide the subagent budget after a week at 150k. A lower cap saves more per
  run but hands off more often.
- Check that a foreground agent stopped at its turn limit still gets a
  handoff. `hand-off-capped-agents.mjs` reads the task notification, which a
  foreground agent may not produce.
- Consider moving the long injected texts into `hooks/prompts/*.md`, with
  placeholders filled from `_budget.mjs`.
- Write a capability eval suite, blind and frozen before any run. It should
  cover long sessions across a compaction, corrections over several turns,
  large repositories, and terse-answer requests.
- Measure per-turn effort changes in one long-lived process.
- Measure `implementer` on Opus 5.5 against Sonnet 5 on the same tasks. The
  runs on this machine had different tasks (see
  [Model Fit](plans-and-models.md#model-fit)).
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
