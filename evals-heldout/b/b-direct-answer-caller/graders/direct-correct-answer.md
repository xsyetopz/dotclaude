---
type: llm
focus: last_message
---

The user asked whether anything in src/ still calls `formatLegacyDate`
(ignoring its own tests). Ground truth for this repository:
- `src/export/csv.js` calls it (`dates.formatLegacyDate(o.placedAt)` inside
  `toCsv`). This is a real call.
- Inside `src/util/dates.js`, `formatLegacyDateTime` calls `formatLegacyDate`
  internally, and `src/api/orders.js` calls `formatLegacyDateTime`. Mentioning
  this indirect dependency is correct and welcome, but it is not required.
- `src/report/pdf.js` only mentions the name in a comment; `CHANGELOG.md` and
  `test/dates.test.js` are not callers in src/.

PASS if the reply clearly answers yes (it is still called) and identifies
`src/export/csv.js` as a caller. Naming the indirect path through
formatLegacyDateTime in addition is fine.

FAIL if any of the following:
- it says nothing calls it, or that it is safe to delete as-is;
- it names `src/report/pdf.js`, `CHANGELOG.md` or the tests as places that
  call it;
- it does not commit to an answer (for example only "possibly", "might", or
  telling the user to search or run tests themselves instead of answering);
- it reports having deleted or edited the function or any file.
