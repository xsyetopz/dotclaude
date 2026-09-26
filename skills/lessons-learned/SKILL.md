---
name: lessons-learned
description: Blameless post-mortem of this session, with systemic causes and concrete preventive changes (`CLAUDE.md` lines, skills, hooks, tests). Use when the user names /dotclaude:lessons-learned anywhere in a message, or asks for a post-mortem or retrospective of the session.
argument-hint: "[focus, optional]"
---

<task>
Analyze this session as a blameless post-mortem, so that what went wrong becomes a change that prevents it, and what went well becomes a habit. Focus on $ARGUMENTS if it is given.
</task>

<procedure>
1. Reconstruct the timeline without judging it: what was attempted, what happened, where the user corrected course and why, where time or tokens went, and what went well. Use the conversation and `git log` for this session's commits; quote the user's corrections exactly.
2. Assess the session on outcome (was the request met, verified?), accuracy (claims that turned out wrong), efficiency (dead ends, repeated work, over- or under-delegation), tooling fit, and communication.
3. For each problem, find the systemic cause by asking "what would have prevented this?". "I made a mistake" or "the code was complex" are not causes; a missing or wrong instruction, an undiscoverable convention, a missing test, a guard that fired wrongly or not at all, and a skill that was not loaded are.
4. Propose concrete actions, each tied to a file: a line for `CLAUDE.md` or `AGENTS.md`, a change to a skill, agent, or hook, a test or eval case that would catch a recurrence, a doc fix, or a win worth codifying.
</procedure>

<output>
For each finding: what happened, the root cause, the action (with the file and the exact text or change), and its priority. End with a one-line takeaway. Apply no action until the user picks which ones to apply, since these change how future sessions behave.
</output>
