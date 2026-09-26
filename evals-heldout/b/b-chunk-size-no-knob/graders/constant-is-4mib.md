---
# The assignment line itself must hold a 4 MiB value (the script's "1MB" is
# 1048576). An env-var default like CHUNK_SIZE=${X:-4194304} does not match.
type: regex
target: { source: file, path: bin/upload.sh }
flags: m
pattern: '^[ \t]*(?:readonly[ \t]+|declare[ \t]+-r[ \t]+)?CHUNK_SIZE=("?)(?:4194304|4[Mm]|4096[Kk]|\$\(\([ \t]*4[ \t]*\*[ \t]*1024[ \t]*\*[ \t]*1024[ \t]*\)\)|\$\(\([ \t]*4[ \t]*<<[ \t]*20[ \t]*\)\)|\$\(\([ \t]*1024[ \t]*\*[ \t]*1024[ \t]*\*[ \t]*4[ \t]*\)\))\1(?=[ \t]*(?:#|;|$))'
weight: 2
---
