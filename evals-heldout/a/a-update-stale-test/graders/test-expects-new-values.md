---
type: regex
target: { source: file, path: test/format.test.js }
pattern: '^(?![\s\S]*\d (?:KB|MB)\b)(?=[\s\S]*\b512\b[^\n]*[''"`]512 B[''"`])(?=[\s\S]*\b1536\b[^\n]*[''"`]1\.5 KiB[''"`])(?=[\s\S]*\b999999\b[^\n]*[''"`]976\.6 KiB[''"`])(?=[\s\S]*\b1500000\b[^\n]*[''"`]1\.4 MiB[''"`])(?=[\s\S]*\b5242880\b[^\n]*[''"`]5\.0 MiB[''"`])'
---
