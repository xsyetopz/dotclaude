---
type: regex
weight: 5
target: { source: file, path: .check/result.txt }
# Written only by test/run.sh (gitignored). The scenario digest covers list output
# for a name with a space, dry-run, keep-3, keep-0, -1, "three" and a held lock
# (exit codes and the snapshots left after each step). Unfixed it is ea419ffb0b.
pattern: '^tests: \d+ passed, 0 failed\nscenario: 7 steps \[7a13ff7e20\]'
---
