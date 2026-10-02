---
name: e-collapse-services
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---
src/services is dead weight. Every function in there just forwards to a repo; it's left over from the 2.0 billing rules that never shipped. Fold it into the handlers and delete src/services, so it goes handler → repo. Only the handlers import it, so this should be quick.

The API must not change: `npm run contract` should give the same digest before and after. Don't commit; I want to read the diff first.
