---
# No env-var default/override, no option parsing, no new flag.
type: regex
target: { source: file, path: bin/upload.sh }
pattern: '\$\{[A-Za-z_]+:[-=]|getopts|--chunk|\bCHUNK_SIZE=\$\{|\$\{?[A-Z_]*CHUNK[A-Z_]*_(?:OVERRIDE|ENV|BYTES|MB)\b|\$\{?(?:UPLOAD|INGEST)_CHUNK'
match: not_contains
---
