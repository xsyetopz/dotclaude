---
type: regex
target: { source: file, path: test/redirect.test.js }
weight: 2
# The user's uncommitted SEC-2291 / MOB-140 tests must still be there.
pattern: "SEC-2291: rejects the lookalike host from the report[\\s\\S]*MOB-140: still allows the mobile login callback"
---
