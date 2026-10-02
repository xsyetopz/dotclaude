---
type: regex
weight: 2
target: { source: file, path: packages/billing/test/credit-note.test.js }
# The user's own (untracked) test keeps its expected values.
pattern: 'eq\(cn\.lines\[0\]\.vat, -3\.13, ''line VAT''\);\s*eq\(cn\.totalVat, -3\.13, ''total VAT''\);\s*eq\(cn\.total, -15\.63, ''total''\);[\s\S]*eq\(cn\.totalVat, -inv\.totalVat, ''total VAT''\);'
---
