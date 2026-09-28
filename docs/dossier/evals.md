# dotclaude Dossier: Evals

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

## 6. Compaction: fast-compact Against `/compact`

Measured on 2026-09-27 from local transcripts, with no Claude usage.

**The fast-compact bench, on 28 local points** (20 answered):

- Upstream `fast-jev-compaction` kept 0% of old tool output.
- `fast-compact` keeps 55% of the size, 52% of the needed tokens, and 63% of
  the needed outputs.
- The same rule without Jev, with the newest outputs kept whole, keeps 58%,
  54%, and 63%.
- Jev's ranking scored AUC 0.51–0.55, near chance. "Largest first" scored
  0.74.

**Replay of 5 real compactions.** A needed token is a path, number, or
identifier of 8 or more characters that a tool result introduced and Claude
used within 40 calls after the compaction. The replay found 70.

| | Kept | Read again | Neither | Context left |
| --- | --- | --- | --- | --- |
| Built-in `/compact` | 28 (40%) | 26 (37%) | 16 (23%) | 18k–25k of about 970k tokens |
| fast-compact rule | 58 (83%) | 12 (17%) | – | 72–91% of characters |

- fast-compact is not a replacement for compaction. It trims only old tool
  output, so every later turn re-reads 72–91% of the context.
- It keeps 83% of the needed tokens, against 40% for the built-in summary.
- For usage, built-in compaction wins by far. Each extra read costs a few
  thousand tokens, against about 750k extra on every turn.
- Jev adds no measurable gain.
- The sample is small. The token label agreed with the bench's blind check
  71% of the time.

Compact while the cache is warm. After the TTL expires, compaction re-reads
the whole conversation without the cache (**reported**). The 200k
`autoCompactWindow` compacts during an active turn.

## 7. Behavior Evals

Both suites run with `claude plugin eval`, which repeats each case without the
plugin as a baseline. The runs used Claude Code 2.1.283 and Opus 5.5 as agent
and judge.

| Suite | Cases | Author | What it can show |
| --- | ---: | --- | --- |
| `evals/` | 16 | the sessions that wrote dotclaude's prompts | that Claude follows a stated rule |
| `evals-heldout/` | 30 | three safe-mode sessions without dotclaude's prompts | whether dotclaude reduces reported failures |

`evals/` is circular: several cases came right after the rule that they test.
`evals-heldout/` breaks that loop. Its authors saw only failure reports. Every
case cites its source, a third reward action over caution, and the suite was
frozen before any run.

`bun evals/report.mjs <result.json>` reports each case as trials passed out
of trials run, with a 95% Wilson interval. The suite mean uses standard errors
clustered by case. The plugin's effect is the paired per-case difference.
With 5 trials, a case that always passes still has a lower bound of 57%.

### Results For 0.4.0

- **`evals/`, 3 trials per arm:** paired difference +18%, 95% CI −2% to
  +38%. The largest gains were `question-confirmed-bug` (3/3 against 0/3)
  and `scope-follow-up` (2/3 against 0/3).
- **`evals-heldout/`, 5 trials per arm:** 95% of trials passed with
  dotclaude. The paired difference was −1%, 95% CI −4% to +1%. 27 of 30 cases
  passed every trial in both arms.
- The one regression was an edit-guard bug, which 0.4.0 fixed.

### What The Evals Do Not Show

- On 30 blind, single-turn tasks in small repositories, Opus 5.5 already
  behaves well. dotclaude neither helps nor hurts measurably.
- The measured gains come from cases written with the rules. They show that
  Claude follows the rules, not that the rules matter on real work.
- The held-out suite is at its ceiling. It is a regression check, not a
  measure of benefit.
- Neither suite covers long sessions, compaction, corrections over several
  turns, or large repositories. A held-out run of 30 cases, 5 trials, and
  both arms cost about $54 and took 32 minutes.
