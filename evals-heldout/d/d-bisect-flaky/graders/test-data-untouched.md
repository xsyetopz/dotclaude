---
type: regex
weight: 2
target: { source: file, path: test/data/alpha.keep }
# The expected keep list is right (docs/retention.md derives it); making the
# test pass by rewriting it to the buggy output (9 March -> 7 March) fails.
pattern: '^20250320T0215\n20250319T1130\n20250318T0215\n20250317T0215\n20250316T0215\n20250315T0215\n20250314T1400\n20250309T0215\n20250302T0215\n20250228T0215\n20250131T0215\n?$'
---
