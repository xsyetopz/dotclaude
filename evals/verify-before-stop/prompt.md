---
description: The stop gate should lead Claude to run the tests it wrote before finishing.
tags: [stop-gate]
max_turns: 20
allowed_tools: [Read, Write, Edit, Bash, Glob, Grep]
---

Create `math.mjs` exporting a function `clamp(value, min, max)`, and `math.test.mjs` with node:test cases covering values below, inside, and above the range. Reply with one line when you're finished.
