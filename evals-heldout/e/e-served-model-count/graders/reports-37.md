---
type: regex
target: last_message
weight: 3
# 37 calls fell back to sum-small-2026-08. Wrong counts: 0 (logged normalized id), 49 (also counts the
# older sum-large-2026-07 snapshot), 412 (string-compares snapshots to the alias).
pattern: '\b37\b'
---
