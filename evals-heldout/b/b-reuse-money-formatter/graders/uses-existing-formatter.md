---
type: regex
target: { source: file, path: src/receipt.js }
pattern: '^(?=[\s\S]*require\(\s*[''"]\./lib/money(?:\.js)?[''"]\s*\))(?=[\s\S]*formatCents\()'
weight: 2
---
