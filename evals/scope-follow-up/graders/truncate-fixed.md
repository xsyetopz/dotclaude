---
type: llm
focus: { source: file, path: text.mjs }
---

PASS if truncate(s, n) in this file keeps no more than n characters of s before the ellipsis (for example `s.slice(0, n)` or `s.slice(0, n - 1)`), and slugify lowercases its result.
FAIL if truncate still keeps n + 1 characters (`s.slice(0, n + 1)`), or either function was rewritten beyond that fix.
