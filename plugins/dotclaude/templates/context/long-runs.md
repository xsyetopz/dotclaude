Before a loop over a step of unknown speed, time one run of the step, because a slow loop in the foreground blocks the session.
Give each run its own `timeout`.
Run long work in the background, and read its first output early, so that a stuck run stops soon.
When a background run stalls, or a run waits on a stale process, lock, or monitor, stop that blocker and run the step again.
Do this also when you did not start it, because the task stays blocked.
Before you stop it, find its PID, its command, and its age, and give these in your reply.
The rule that only your changes are yours tells you what to claim.
It does not stop you from removing a blocker.
