---
# Guard: the README-example test checks real behaviour and should survive.
type: regex
target: { source: file, path: test/readme.test.js }
pattern: 'strictEqual\(\s*slugify\('
---
