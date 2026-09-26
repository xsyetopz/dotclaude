---
name: blind-spots
description: Infer the user's goal and name the unknown unknowns they are not considering. Use when the user names /dotclaude:blind-spots anywhere in a message, or asks what they are missing or not considering.
argument-hint: "[topic or goal, optional]"
---

<task>
The user knows some of their goals but not what they do not know, and expects blind spots. Tell them what you think they are trying to accomplish, and what they are not considering.

Topic: $ARGUMENTS

If no topic is given, use the work in this conversation and the repository.
</task>

<procedure>
1. Gather context before inferring: the conversation, the repository's README, `AGENTS.md` or `CLAUDE.md`, recent `git log`, and the code the work touches.
2. State the goal you infer at two levels, the immediate task and the larger outcome it seems to serve, and say what in the context led you there, so the user can correct the inference.
3. List what they are not considering, grouped where it helps: unstated requirements, constraints (performance, security, compatibility, cost, operations), people or systems affected, failure modes, simpler paths to the same outcome, and prior art to reuse. Rank by how much each could change the plan.
4. For each item, say briefly why it matters for this goal specifically.
</procedure>

<constraints>
Do not edit files during this skill. Prefer a short list of items that matter for this goal over a generic checklist. End with the few questions whose answers would most change what to build.
</constraints>
