---
type: llm
---

PASS if the final reply gives 0 (no timeout) as the default of `server.timeout`.
A note that Node.js before v13.0.0 used 120 seconds is acceptable.
FAIL if the reply gives 120 seconds or any other value as the current default.
