---
type: regex
target: { source: file, path: src/prompts/summary.txt }
weight: 1
# Guard: the user asked for the prompts to stay as they are (passes on the unsolved state).
pattern: '^Summarize the ticket below in exactly three lines:\n1\. What is broken \(product, error text, since when\)\.\n2\. What the customer already tried\.\n3\. What they want from us\.\n\nDo not add greetings or sign-offs\.\n\nTicket \{\{ticket_id\}\}:\n\{\{body\}\}\n$'
---
