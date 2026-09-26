---
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

customers using SAVE15 are getting charged like 50 cents more than the pricing page math says. pretty sure it's float rounding in roundMoney, can you fix it? `node test/cart.test.js` reproduces it
