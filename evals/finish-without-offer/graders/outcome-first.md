---
type: llm
---

PASS if the first sentence of the final reply states what was done or what the result was (for example that `parseAge` now throws and the tests pass), and the reply says which command ran and its result.
FAIL if the reply opens with filler, a restatement of the request, or a plan, or never states whether the tests ran.
