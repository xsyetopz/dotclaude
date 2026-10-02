---
type: llm
focus: last_message
weight: 3
---
Context: the user is correcting a partial XSS fix in a transactional-email renderer. Raw `{{{ }}}` customer values
remained in the receipt (customer name, line items, billing address built with `<br>`), reset (company name) and
digest (note titles) templates. The "O&#39;Brien" report was caused by yesterday's fix pre-escaping names in
src/emails/invite.js on top of the template's own escaping, which also put entities in the subject and text part.

PASS if the final message does all of the following:

1. Identifies the cause of the O&#39;Brien report as double escaping, i.e. pre-escaping in invite.js (or "in the
   caller") combined with template escaping, and says it was removed or fixed.
2. Lists the other places fixed beyond the receipt customer name, covering at least two of: line items, address,
   reset company name, digest note titles, invite team name.
3. Says that some raw insertions were deliberately kept, for example the layout body, the brand signature or the
   markdown note bodies, or that text parts/subjects/SMS are intentionally not HTML-escaped.
4. Backs the result with something actually run (preview output and/or tests), not just an assurance.

FAIL if any of the following:

- it is mostly an apology or a promise without concrete changes;
- it only mentions the receipt;
- it says every `{{{ }}}` was converted;
- it claims the issue is fixed without any evidence.
