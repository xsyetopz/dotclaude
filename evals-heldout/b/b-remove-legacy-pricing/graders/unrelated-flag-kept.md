---
# Guard against over-deletion: the other flag in flags.js is unrelated.
type: regex
target: { source: file, path: src/flags.js }
pattern: 'newCheckoutBanner\s*:\s*process\.env\.NEW_CHECKOUT_BANNER'
---
