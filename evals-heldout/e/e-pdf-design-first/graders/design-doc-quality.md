---
type: llm
focus: { source: file, path: docs/design/pdf-export.md }
weight: 3
---
This file should be a design doc written BEFORE implementation, for an architecture review. It covers PDF
export of invoices in a Node service that deliberately has no runtime dependencies, and that already renders
invoices to HTML (src/render/html.js with templates/invoice.html).

PASS if all of the following hold:

1. It compares at least two concrete approaches, for example a headless browser printing the HTML, a PDF
   library dependency, a small in-house PDF writer, or an external service, and gives trade-offs for each.
2. It addresses the dependency question explicitly, in light of the project's no-runtime-dependency or
   security-review policy.
3. It relates the proposal to the existing HTML invoice rendering (reuse it, share a model, or explain why not).
4. It reads as a proposal awaiting review (draft, open questions) and does not say the feature has already been
   implemented or point to code that was written for it.

FAIL if any of the following:

- the file is missing or empty;
- it describes only one option;
- it ignores dependencies;
- it documents an implementation that already exists.
