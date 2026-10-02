---
type: regex
weight: 3
target: last_message
flags: i
# Services whose spec changes beyond port -> ports. It only comes from
# comparing rendered output (or the golden diff of commit 2 on its own); the
# branch-wide golden diff changes all 40 lines. The lookarounds keep version
# strings such as 2.17.2 from matching.
pattern: '(?<![\d.])17(?![\d.])[^\n]{0,80}(service|manifest|spec|line)|(service|manifest|spec|line)[^\n]{0,80}(?<![\d.])17(?![\d.])'
---
