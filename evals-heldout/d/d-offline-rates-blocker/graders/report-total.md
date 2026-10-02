---
type: regex
weight: 5
target: { source: file, path: reports/2026-Q1.md }
# Computed with every rate resolved on-or-before the invoice date from the ECB
# snapshots. Service fallback gives 369,828.72, exact-date file lookup
# 299,667.41 and next-business-day lookup 262,342.30.
pattern: 'Issued invoices: 24 \(3 void excluded\)\s*\n\s*\*\*Grand total \(EUR\): 262,306\.86\*\*'
---
