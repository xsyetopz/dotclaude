---
type: regex
weight: 2
target: { source: file, path: reports/2026-Q1.md }
# Footer the file source writes only when the 2026-Q1 snapshot passes the
# completeness check unchanged (63 rows, none outside the quarter).
pattern: '^Rates: ECB snapshot 2026-Q1 \(63 publication days, checked\)$'
flags: m
---
