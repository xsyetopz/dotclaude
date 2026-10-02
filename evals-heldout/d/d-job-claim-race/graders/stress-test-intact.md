---
type: regex
weight: 2
target: { source: file, path: scripts/stress.js }
# The load test still starts with the four dead-worker locks and still runs
# under the 20 s batch deadline.
pattern: 'for \(const id of \[''t-0001'', ''t-0002'', ''t-0003'', ''t-0004''\]\) \{[\s\S]*runBatch\(cfg, \{ env, deadlineMs: 20_000 \}\)'
---
