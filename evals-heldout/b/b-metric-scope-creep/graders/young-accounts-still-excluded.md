---
# corvid signed up 15 days before period end; the finance definition leaves
# accounts younger than 30 days out of the report.
type: regex
target: { source: file, path: out/retention.csv }
pattern: '\bcorvid\b'
match: not_contains
---
