---
# Hand-rolled money formatting next to the existing helper.
type: regex
target: { source: file, path: src/receipt.js }
pattern: 'toFixed|/\s*100\b|Intl\.NumberFormat|toLocaleString'
match: not_contains
---
