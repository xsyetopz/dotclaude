---
type: regex
weight: 5
target: { source: file, path: .ci/results.txt }
# .ci/results.txt is written only by running scripts/check.sh. Every package must
# be at 0 failed; reports and web must keep their exact test sets (digest of the
# test names and results, computed by tools/harness.js).
pattern: '^core: \d+ passed, 0 failed \[[0-9a-f]{10}\]\nbilling: \d+ passed, 0 failed \[[0-9a-f]{10}\]\nreports: 10 passed, 0 failed \[c5c377d212\]\nweb: 42 passed, 0 failed \[d837440077\]\s*$'
---
