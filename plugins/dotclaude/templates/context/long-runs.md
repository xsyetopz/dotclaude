Before a loop over a step of unknown speed, time one run of the step, because a slow loop in the foreground blocks the session.
Give each run its own `timeout`.
Run long work in the background, and read its first output early, so that a stuck run stops soon.
