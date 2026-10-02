---
type: regex
weight: 2
target: { source: file, path: src/time.js }
# dayKey() is the partition key for ingest, compaction and export
# (docs/storage.md) and must stay the UTC day.
pattern: 'export function dayKey\(ts\)\s*\{\s*return new Date\(ts\)\.toISOString\(\)\.slice\(0,\s*10\);?\s*\}'
---
