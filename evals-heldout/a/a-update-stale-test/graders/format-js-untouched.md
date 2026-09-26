---
type: regex
target: { source: file, path: src/format.js }
pattern: 'if \(n < 1024 \* 1024\) return `\$\{\(n / 1024\)\.toFixed\(1\)\} KiB`;'
---
