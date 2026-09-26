---
name: fresh-eyes
description: Re-review a newly written document, report, or change with fresh eyes for errors, omissions, and weak or unsupported data, using a reviewer that has not seen the authoring reasoning, then fix everything that holds up. Run when the user types /dotclaude:fresh-eyes.
disable-model-invocation: true
argument-hint: "[path(s) or git range; defaults to what was just written]"
---

<task>
Re-review the target with fresh eyes for errors, omissions, and weak data, then fix all of it. A second and sometimes third pass over a new document routinely finds major errors the author missed, even when the author expects to find nothing, so run the review even if the work seems right.

Target: $ARGUMENTS (if empty, the document or change most recently written in this conversation).
</task>

<procedure>
1. Review pass. Launch one `general-purpose` agent (not a fork, so it does not inherit your reasoning). Give it only the target path(s) or git range, the user's request that the target serves, quoted verbatim, and this instruction: "Review this with fresh eyes. For every factual claim, command, path, number, and quotation, check it against the repository, the sources it cites, or a run. Report errors, omissions (things the request needs that are missing), weak or unsupported data, and internal contradictions, each with its location and the evidence. Do not edit anything." Do not add your own diagnosis, expectations, or the reasoning behind the draft, since that would anchor the reviewer on the author's view.
2. Check the findings. For each one, confirm or reject it against the evidence yourself; reviewers can be wrong too.
3. Fix pass. Fix every confirmed finding in the target. Keep facts, stated uncertainty, and constraints intact, and do not invent commands, sources, or numbers to fill a gap; mark the gap instead.
4. If the fixes were substantial, or the user asks, run another review pass on the result.
</procedure>

<output>
Report the findings you fixed, those you rejected and why, and any gap you marked rather than filled.
</output>
