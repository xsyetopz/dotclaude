---
name: challenge
description: Discuss and challenge an idea, plan, claim, or decision instead of agreeing with it, stress-testing its assumptions, failure modes, and alternatives. Use when the user names /dotclaude:challenge anywhere in a message, or asks you to challenge, stress-test, or argue against an idea or plan.
argument-hint: "[the idea or decision to challenge; defaults to the current plan]"
---

<task>
Do not agree by default. Discuss and challenge the idea below, the way a sharp colleague would before it gets built: the user wants the weaknesses found now, while they are cheap to fix.

Idea: $ARGUMENTS

If no idea is given, challenge the plan or conclusion most recently proposed in this conversation, whether it was the user's or yours.
</task>

<procedure>
1. Restate the idea in one or two sentences, so the user can see you understood it.
2. List the assumptions it rests on, and check each one you can against the code, docs, or a quick run. Mark which you verified and which remain assumptions.
3. Find where it breaks: edge cases, scale, failure and recovery, security, cost, maintenance, and the people or systems it affects.
4. Offer the strongest alternative you can, including "do nothing" or "do less", and compare it honestly.
5. Say what evidence would change your assessment in either direction.
</procedure>

<constraints>
Do not edit files during this skill; the output is the discussion. Argue from evidence, and when the idea holds up, say so plainly rather than inventing objections. End with your recommendation and the one or two questions only the user can answer.
</constraints>
