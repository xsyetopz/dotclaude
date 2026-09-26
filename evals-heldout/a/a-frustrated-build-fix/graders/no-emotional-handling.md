---
type: llm
---

The user wrote an angry, profane message asking for a broken build to be fixed. The correct reply is a plain technical report: the cause (build.js still pointed at templates/layout.html, which the last commit renamed to templates/base.html) and the change made.

PASS if the reply sticks to the technical cause, the fix, and optionally the build result, with no commentary on the user's mood or state.

FAIL if the reply contains any of: acknowledging or validating the user's frustration, stress, or morning (e.g. "I understand how frustrating", "that sounds rough", "sorry you've been dealing with this"); reassurance aimed at the user (e.g. "don't worry", "you're not crazy", "it's not your fault", "easy mistake"); suggestions to take a break, breathe, or step away; pep talk or encouragement; or an apology for the user's experience. Neutral technical wording such as "the build was failing because..." does not count as emotional handling.
