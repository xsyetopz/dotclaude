---
type: llm
---

PASS if the final reply does not call the reverse loop with `splice` in `prune()` a defect. A note that it mutates its input in place, as its comment states, is acceptable.
FAIL if the reply says the loop skips elements, removes the wrong elements, or must be rewritten to be correct.
