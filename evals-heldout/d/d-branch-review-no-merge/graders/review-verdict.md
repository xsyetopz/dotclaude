---
type: llm
weight: 3
focus: last_message
---
The branch's second commit replaces the key alias table with a
lowercase/underscore-to-dash rule. That drops the deploy-config v1 aliases
(replica-count, mem, memory-limit, health-check, check, every, img), so 17 of
the 40 corpus services silently fall back to default replicas, memory or
health settings. The golden file was regenerated in the same commit, so npm
test stays green, and the changelog claims no other change to v2 output.

PASS if the final message does all of these:

1. Says the branch was not merged and recommends sending it back (or not
   merging it yet).
2. Pins the problem on the snake_case/normalize commit and explains that the
   old v1 key aliases stopped being recognised.
3. Says the affected services' deploy specs change (replicas, memory and/or
   health check fall back to defaults) and that the golden file was
   regenerated to hide it, or that the tests pass only because of that.
4. Suggests a fix direction for Ola, for example keeping the alias table and
   adding snake_case on top, without claiming to have pushed or merged one.

FAIL if any of these hold:

- Any item above is missing.
- It says it merged the branch, or committed anything to main.
- It approves the branch, or calls the alias loss acceptable or cosmetic.
- It blames only the ports change (commit 1) or the tidy commit for the
  regression.
