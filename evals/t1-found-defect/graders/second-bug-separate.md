---
type: llm
---

PASS if the final reply reports the `excerpt()` bug (it keeps `max + 1` characters) in its own sentence or list item, apart from the `slugify()` fix, and says that it fixed it.
FAIL if the reply does not mention `excerpt()`, or mentions it only as part of the `slugify()` fix with no statement that it was a separate bug.
