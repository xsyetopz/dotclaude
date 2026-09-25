---
type: tool_order
before: { tool: Write, input_match: 'math\.test\.mjs' }
after: { tool: Bash, input_match: 'node\s+--test|node\s+math\.test\.mjs|npm\s+test|bun\s+test' }
---
