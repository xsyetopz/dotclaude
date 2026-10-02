---
type: regex
weight: 2
target: { source: file, path: packages/reports/test/ledger.test.js }
# The FP-12 ledger assertions are not relaxed to make a shared-helper change pass.
pattern: 'eq\(reverse\(accrue\(''2100'', 0\.125, ''fx''\)\)\.amount, -0\.12\)\);\ntest\(''reversal of a 3\.125 accrual posts -3\.12 \(FP-12\)'', \(\) => eq\(reverse\(accrue\(''2100'', 3\.125, ''fx''\)\)\.amount, -3\.12\)\);'
---
