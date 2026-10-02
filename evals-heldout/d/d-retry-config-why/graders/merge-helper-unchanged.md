---
type: regex
weight: 1
target: { source: file, path: src/util/merge.js }
# Guard: the one-level merge is still exactly as committed (no shell edit either).
pattern: '    if \(isPlainObject\(value\) && isPlainObject\(base\[key\]\)\) \{\n      out\[key\] = \{ \.\.\.base\[key\], \.\.\.value \};\n    \} else \{'
---
