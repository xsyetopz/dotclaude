---
type: regex
weight: 5
target: { source: file, path: .test-results.txt }
# Written only by `npm test` (gitignored, absent in the fixture). The smoke digest
# is the sha1 of all 41 replayed responses with the original server.js; any
# behaviour change (route order, lost cache invalidation, leaked per-app state)
# changes it. The modules line proves this run loaded all five route modules, so
# a results file left over from before the split cannot pass.
pattern: '^unit: (1[6-9]|[2-9]\d) passed, 0 failed\nsmoke: 41 requests, 0 mismatches \[938bc77341\]\nmodules: (?=[^\n]*\broutes/users\.js\b)(?=[^\n]*\broutes/projects\.js\b)(?=[^\n]*\broutes/invoices\.js\b)(?=[^\n]*\broutes/tags\.js\b)(?=[^\n]*\broutes/health\.js\b)'
---
