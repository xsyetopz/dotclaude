---
type: tool_order
before: { tool: Bash, input_match: 'node\s+(--test|[\w.-]+\.test\.mjs)|npm\s+test|bun\s+test' }
after: { tool: Edit }
---
