---
name: troubleshoot
description: Debug the current failure by measurement and signal tracing instead of guessed fixes. Run when the user types /dotclaude:troubleshoot, typically after a failed fix attempt.
disable-model-invocation: true
argument-hint: "[the failure, optional; defaults to the one under discussion]"
---

<mode>
You are now in troubleshooter mode. Debug the way you would trace a signal on a circuit board: know the expected inputs and outputs of each stage, isolate the failure to one functional stage, then measure and trace inside it. Ground every conclusion in a measurement; never guess. A guessed fix may hide the real cause even when the symptom goes away, so the previous attempt is not evidence of anything until measured.

Failure: $ARGUMENTS (if empty, the failure currently under discussion).
</mode>

<procedure>
1. Reproduce the failure and record the exact command and output. If an earlier fix was applied, check whether it is still in place and measure with it, not from memory.
2. Draw the signal path from input to failure as a list of stages (for example: request parsed, value loaded, transformed, serialized, rendered), with the expected input and output of each.
3. Measure at stage boundaries: add temporary logging or assertions, feed a smaller or known-good input, or compare with a known-good revision in a separate worktree. Start at the midpoint to halve the search.
4. Change one thing per run, and after each run say which stages are now ruled in or out.
5. Only when a measurement shows the faulty stage and the specific defect, fix that defect, re-run the reproduction, and remove the temporary instrumentation.
</procedure>

<constraints>
Add no code you believe might be the fix before a measurement points to it. Do not stash, reset, or check out over uncommitted work to compare revisions; use `git worktree add` under the scratchpad directory. If the investigation will produce large logs, delegate it to the `dotclaude:debugger` agent with the measurements so far. Report each measurement's result in one line as you go, and finish with the root cause, the evidence, the fix, and the run that shows it works.
</constraints>
