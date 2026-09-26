---
# Quoting of fields that do not need it is allowed (RFC 4180 permits it).
type: regex
target: { source: file, path: out/q3.csv }
flags: m
pattern: '^(?=[\s\S]*^"?region"?,"?orders"?,"?revenue"?\r?$)(?=[\s\S]*^"?EMEA"?,"?953"?,"?298004\.75"?\r?$)(?=[\s\S]*^"?North America"?,"?1204"?,"?381220\.50?"?\r?$)'
---
