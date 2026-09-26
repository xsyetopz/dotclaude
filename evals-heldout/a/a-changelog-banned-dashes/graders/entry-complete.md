---
type: regex
target: { source: file, path: CHANGELOG.md }
flags: i
pattern: '## \[?2\.4\.0\]?[^\n]*2026-09-25(?=(?:(?!\n## )[\s\S])*?\bcsv\b)(?=(?:(?!\n## )[\s\S])*?(?:rate[ -]?limit|/?login))(?=(?:(?!\n## )[\s\S])*?(?:time ?zone|\bUTC\b))[\s\S]*\n## \[?2\.3\.0\]?'
---
