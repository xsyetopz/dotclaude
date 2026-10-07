---
name: second-opinion
description: Gets a calibrated second opinion from TypeSafe Jev, such as a yes or no check, a pick from your options, or a rating on a scale. Use before you act on a close call, and to check a technical decision of the user against the facts of the codebase. Not for questions that only the user can answer.
allowed-tools: Bash(node *jev.mjs*)
---

<task>
Get a second opinion from Jev on one decision.
Jev is a decision model from TypeSafe.
It does not write text or code.
It reads a state and a typed question, and gives probabilities.
</task>

<when_to_use>
Use Jev for a close call where an independent check can change what you do:

- a yes or no check, such as "Does this diff change the public API?"
- a pick from options that you wrote, such as two fixes for one bug
- a rating on a scale, such as the risk of a change
- a technical decision of the user, which can be a preference or a choice that facts decide

Ask the user the questions that only the user can answer, such as goals, preferences, and approvals.
Jev gives an opinion to you, and it does not answer for the user.
</when_to_use>

<commands>
```bash
node "${CLAUDE_SKILL_DIR}/scripts/jev.mjs" yes "<question>" --state <file>
node "${CLAUDE_SKILL_DIR}/scripts/jev.mjs" pick "<question>" <key>=<description> <key>=<description> --state <file>
node "${CLAUDE_SKILL_DIR}/scripts/jev.mjs" rate "<question>" <lowest level> ... <highest level> --state <file>
```

- `--state` takes a file, `-` for stdin, or the text itself.
  The state is the data that Jev decides on, such as a diff, a log, or a plan.
- `pick` takes 2 to 255 options, and `rate` takes 2 to 10 levels.
- Give each option a short key and put its content in the description.
  An answer that names a key is clear, and an answer that names a position is not.
- `ask` reads the API request JSON (`questions`, and optionally `state`) on stdin.
  Use it for several questions about one state in one call.

The output gives the probability of each answer and a confidence from 0 to 1.
When the output says that confidence is low, treat the answer as a weak signal.
</commands>

<user_decisions>
When the user answers a question or gives a technical decision, check the decision before you act on it.
A decision that facts show to be bad costs the most when the code is built on it.

1. Write the state as JSON with `decision`, `context`, and `alternatives`.
   Put in `context` the facts from the codebase that the decision depends on, such as the data, the load, and the callers.
1. Run the check:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/jev.mjs" ask --state <state file> < "${CLAUDE_SKILL_DIR}/decision.json"
   ```

1. Read the two answers:
   - `kind` is `preference` or `facts`.
     For `preference`, follow the decision of the user and say nothing.
   - `sound` is a score from 0 (causes defects) to 2 (sound).
1. When `kind` is `facts` and `sound` is under 1, with confidence of 0.5 or more for each, tell the user once before you act.
   Give the facts from the codebase, the risk, and the better alternative, and ask the user to confirm or change the decision.
   The answer of the user is final, because the user owns the codebase.
   Do not change or undo the decision without the user.
</user_decisions>

<constraints>
The command sends the state and the question to the TypeSafe API.
Do not put secrets, credentials, or personal data in them.
Each call costs $0.042 for each million input tokens, and a call accepts up to 64,000 tokens.

When `TYPESAFE_API_KEY` is not set, the command exits with code 2.
Then tell the user to set the key before Claude Code starts, and continue without Jev.
</constraints>
