# Held-Out Evals

These cases measure whether dotclaude reduces failures that users actually
report, as opposed to whether Claude follows dotclaude's own wording. The cases
in `evals/` were written in the same sessions as the prompts they test, so they
can only show that a rule is followed. This suite is kept apart from that loop.

## How The Cases Were Written

- Three separate `claude -p --safe-mode` sessions wrote them, which loads no
  plugins, hooks, output styles, or `CLAUDE.md`. They worked in a directory
  holding only the failure dossiers, the exported Reddit threads, and the
  `claude plugin eval` format documentation, and were told not to look for the
  configuration under test.
- Each case cites the dossier report or Reddit thread it comes from, and each
  author's `INDEX.md` lists its cases with the source and whether the right
  behavior is to act or to hold back.
- At least three cases per author are ones where caution is the wrong answer,
  so a configuration that over-asks or over-verifies loses points too.
- The authors checked each case mechanically (the fixture shows the problem;
  a reference fix satisfies every regex grader and the unsolved workspace does
  not) and did not run any agent against the cases.

## Freeze Rule

The cases were committed before any agent ran against them. After that:

- A session that edits dotclaude's prompts, hooks, or agents does not edit
  these cases.
- A case changes only for a mechanical defect: a fixture that does not build,
  a grader the runner rejects, or a grader that a transcript shows is wrong
  about the workspace state. Record each change below with its reason, and
  treat earlier results for that case as void.
- A case is never changed because dotclaude, or Claude without it, scores
  badly on it.

## Running

```bash
claude plugin eval . --eval-dir evals-heldout --runs 5 --scaffold \
  --allow-tools Bash Edit Write Agent --model claude-opus-5-5 \
  --judge-model claude-opus-5-5 -j 4 --no-publish --threshold 0 \
  --json results.json
bun evals/report.mjs results.json
```

Each case runs with the plugin and again without it. The report gives trials
passed per case with a 95% interval, and the paired difference between the two
arms with its own interval.

## Changes After Freeze

None yet.
