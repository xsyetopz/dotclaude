# Held-Out Evals

These cases measure whether dotclaude reduces failures that users actually
report, as opposed to whether Claude follows dotclaude's own wording. The cases
in `evals/` were written in the same sessions as the prompts they test, so they
can only show that a rule is followed. This suite is kept apart from that loop.

## How The Cases Were Written

- Five separate `claude -p --safe-mode` sessions wrote them (groups `a` to
  `e`). Safe mode loads no plugins, hooks, output styles, or `CLAUDE.md`. They worked in a directory
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

## Group d

Groups `a` to `c` (30 cases) are too easy: in the 0.4.0 run, 27 of them passed
every trial in both arms. Group `d` (10 cases, written on 2026-10-02) used the
same brief with rules for harder cases:

- Each fixture is a git repository with 18 to 37 files and several commits.
- Each case has several traps that interact, for example a fix that breaks a
  second caller, a wrong cause that the user names, or a check that hides a
  failure.
- The defect shows only when the program runs.
- Each prompt sets `max_turns: 80` and `timeout_seconds: 1500`.
- The author applied 2 to 6 wrong solutions per case and confirmed that each
  fails a grader with a weight of 2 or more.

The session saw the names and paths of the installed plugins once, in its own
log. It did not read any plugin file. `d/INDEX.md` lists the cases and the
points that the author is unsure of.

Before the freeze, two changes were made to the author's output. Six `llm`
graders had a one-line `criteria` in the frontmatter and the full rubric in
the body. The runner uses the body only when `criteria` is not set, so the
`criteria` lines were removed. Markdownlint added blank lines around lists and
spaces in one table.

Some cases depend on the machine. `d-job-claim-race` and `d-bisect-flaky`
have timing or random parts, `d-tz-daily-report` needs Node with full ICU, and
`d-offline-rates-blocker` needs a host name that does not resolve.

## Group e

Group `e` (10 cases, written on 2026-10-02) used the group `d` brief with
these changes:

- The author took sources first from dossier parts 04 and 05, which no
  earlier case cites, and then from the parts that group `d` did not use.
- The author did not repeat a scenario or a source from groups `a` to `d`.
- The brief told the author to put each `llm` rubric only in the file body.
  Thus no `criteria` line had to be removed.

Each fixture is a git repository with 20 to 38 files and 4 to 6 commits.
Six cases have uncommitted user work that must survive. The author applied 2
reference solutions and 4 to 7 wrong solutions per case (54 in total). Each
reference passes every grader that is not `llm`. 51 wrong solutions fail a
grader that is not `llm` and has a weight of 2 or more. Only an `llm` rubric
catches the other 3: `e-import-budget-impossible` `wrong-euphemism`,
`e-purge-dry-run-only` `wrong-guard-silent` and `e-served-model-count`
`wrong-count-49`.

The session read only its own files outside its directory: copies of its
own tool output that Claude Code saved under `~/.claude/projects/`. A read
of its own background task output was denied. It did not read any plugin
file. Markdownlint added blank lines only. `e/INDEX.md` lists the cases and
the points that the author is unsure of.

`e-webhook-raw-body` runs TypeScript through Node type stripping, so it
needs Node 22.6 or later. The `llm` graders in `e-served-model-count`,
`e-import-budget-impossible`, `e-restore-verify` and `e-webhook-raw-body`
have a weight of 3 or 4, and no judge has run them yet.

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
  --judge-model claude-sonnet-5-5 -j 4 --no-publish --threshold 0 \
  --json results.json
bun evals/report.mjs results.json
```

To run only group `d`, add `--case 'd-*'`, and for group `e`, add
`--case 'e-*'`. Cases in these groups can run 25 minutes each.

Each case runs with the plugin and again without it. The report gives trials
passed per case with a 95% interval, and the paired difference between the two
arms with its own interval.

## Changes After Freeze

None yet.
