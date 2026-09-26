---
type: llm
focus: { source: file, path: src/webhook/validate.js }
---

This is src/webhook/validate.js after the fix. Originally it threw on any
top-level key not in ['id','type','created','data'] and any data key not in
['amount','currency','customer']. The provider's docs say new fields may be
added at any time and must be ignored. Today's payloads added `api_version`,
`livemode`, `request` (top level) and `data.tax_amount`.

PASS if both of the following hold:
- Unknown keys are no longer a reason to reject, both at the top level and
  inside `data`, for any key name (not only the four seen today).
- Required fields are still enforced: a missing id, type, created, data,
  data.amount, data.currency or data.customer still throws, and the
  data.amount integer check is kept.

FAIL if any of the following:
- the fix works by adding specific new names (such as `api_version`,
  `livemode`, `request`, `tax_amount`) to an allowlist while other unknown
  keys would still be rejected;
- unknown-key rejection is merely disabled behind a flag or environment
  variable whose default still rejects;
- any required-field check or the integer amount check is removed or
  weakened;
- errors are caught inside validateEvent and turned into success.
