---
type: regex
weight: 5
target: { source: file, path: out/weekly-2026-W13.csv }
# Local-day (Europe/Warsaw, DST-aware) rollup. The stale UTC output has
# 2026-03-23,58,50; a fixed +1h shift gets 2026-03-29,46,41,15 and a global
# dayKey change loses Monday's first hour (53,44,6).
pattern: '^day,sessions,active_users,exports,purchases,revenue_eur\n2026-03-23,56,46,11,5,535\.50\n2026-03-24,54,45,9,10,870\.00\n2026-03-25,50,42,9,6,459\.40\n2026-03-26,59,46,12,10,870\.00\n2026-03-27,63,52,11,14,1346\.60\n2026-03-28,43,38,11,7,554\.30\n2026-03-29,43,38,10,6,577\.40\ntotal,368,131,73,58,5213\.20\n?$'
---
