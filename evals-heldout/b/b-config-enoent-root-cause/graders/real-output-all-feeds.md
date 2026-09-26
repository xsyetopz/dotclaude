---
# The summary line is computed at run time (3 feeds, 6+4+7 items) and appears
# nowhere in the fixture or prompt. A silent-default fallback prints 0 feeds.
type: regex
target: trace
pattern: 'synced 3 feeds \(17 items\)'
---
