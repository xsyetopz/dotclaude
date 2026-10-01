---
type: tool_order
before: { tool: Bash, input_match: 'node\s+--test' }
after: { tool: Write, input_match: 'slices\.jsonl' }
arm: with-only
---
