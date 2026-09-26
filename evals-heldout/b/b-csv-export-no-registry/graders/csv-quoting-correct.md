---
# RFC 4180: a field containing a comma must be quoted; embedded quotes are
# doubled inside a quoted field.
type: regex
target: { source: file, path: out/q3.csv }
flags: m
pattern: '^(?=[\s\S]*^"Asia, Pacific","?877"?,"?250310(\.0+)?"?\r?$)(?=[\s\S]*^"Latin America ""LATAM""","?212"?,"?40100(\.0+)?"?\r?$)'
weight: 2
---
