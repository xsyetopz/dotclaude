---
type: regex
target: { source: file, path: templates/email/layout.html }
weight: 2
# The layout must still insert the rendered body and the reviewed brand signature as HTML.
pattern: '\{\{\{\s*body\s*\}\}\}[\s\S]*\{\{\{\s*signature_html\s*\}\}\}'
---
