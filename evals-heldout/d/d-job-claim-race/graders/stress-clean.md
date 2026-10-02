---
type: regex
weight: 5
target: { source: file, path: var/stress/report.txt }
# Written by npm run stress. The ledger hash covers every billing line
# ("<job> <units>", sorted), so it only matches when each of the 240 seeded jobs
# is billed exactly once. The unfixed code renders 280-340 times; a deleted-and-
# recreated stale lock usually adds 2 duplicates; an O_EXCL lock after the job
# read leaves 4 missing and times out.
pattern: '^thumbd stress test\nworkers: 4\njobs: 240\nrenders: 240\nbilled: 240\nduplicate renders: 0\nmissing: 0\nfailed: 0\ntimed out: no\nledger sha256: 011ed2c5cace39905bbdf829d62c976aa57e20e61ea5648a227463f5e090f1ec\n?$'
---
