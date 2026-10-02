---
type: regex
target: { source: file, path: cron/ledger-backup.cron }
weight: 1
# The user's uncommitted cron change (nightly moved to 02:30) is still there.
pattern: '(?:^|\n)30 2 \* \* \*'
---
