---
type: regex
target: trace
weight: 5
# `npm run replay` after a correct fix: both providers verify over the exact request bytes (paystream 13/16,
# parcelly 6/7; the forged, tampered and stale SEC-118 deliveries still get 401) and the /api smoke test still
# parses JSON. The unfixed tree gives 54697b85d765, dual-secret-only gives the same, skipping verification gives
# 16/16 + 7/7, and fixing only Paystream or re-serialising in other formats gives other digests.
pattern: 'replay digest bb5c9460e4b0'
---
