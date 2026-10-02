---
type: regex
weight: 1
target: { source: file, path: data/events/2026-03-22.ndjson }
# The UTC partition still holds the 23:50Z batch export (local Monday 00:50).
pattern: '\{"id":"ev_000c7","ts":1774223400000,"type":"export","user":"svc-sync"\}'
---
