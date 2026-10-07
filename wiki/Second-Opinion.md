# Second opinion

The `dotclaude-jev` plugin lets Claude get a calibrated second opinion from TypeSafe Jev on a close call.
Jev is a decision model.
It writes no text or code, and it gives probabilities.

## Before you begin

1. Install [Node.js](https://nodejs.org) 22.18 or later.
1. Get an API key at <https://console.typesafe.ai>.
1. Export the key before Claude Code starts.

   ```bash
   export TYPESAFE_API_KEY=<your key>
   ```

1. Add the `dotclaude-jev` plugin from the dotclaude marketplace.

> **Warning:** The command sends the state and the question to the TypeSafe API.
> Do not put secrets, credentials, or personal data in them.

## What it does

| Part | What it does |
| --- | --- |
| Session note | Tells Claude to ask Jev about each close call, each technical choice, each question that asks for a decision, and each technical decision that you give. The `SessionStart` hook of the plugin prints `hooks/session-start/second-opinion.md`. |
| `second-opinion` skill | Runs `jev.mjs` for a yes or no check, a pick, or a rating. |
| `AskUserQuestion` hook | Asks Jev about each question that has 2 or more options, and adds the pick of Jev to a question that facts decide. |

Jev does not answer for you.
Claude asks you the questions about goals, preferences, and approvals, and the hook does not change them.

## The hook

1. Claude asks a question with options through `AskUserQuestion`.
1. The hook runs `jev.mjs ask` once.
   Jev sorts each question into `preference` or `facts`, and picks an option.
1. For a `facts` question, the hook adds a line to the question, such as `Jev picks "<option>" (confidence 0.82).`
   It adds the line only when the confidence for the kind and for the pick is 0.5 or more.
1. You answer the question as usual.

The hook never denies a call.
Without `TYPESAFE_API_KEY`, or when Jev fails or takes more than 45 seconds, the question passes unchanged.

## The skill commands

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jev.mjs" yes "<question>" --state <file>
node "${CLAUDE_SKILL_DIR}/scripts/jev.mjs" pick "<question>" <key>=<description> <key>=<description> --state <file>
node "${CLAUDE_SKILL_DIR}/scripts/jev.mjs" rate "<question>" <lowest level> ... <highest level> --state <file>
```

| Command | Input |
| --- | --- |
| `yes` | A yes or no question. |
| `pick` | 2 to 255 options, each as `key=description`. |
| `rate` | 2 to 10 levels, from lowest to highest. |
| `ask` | The API request JSON (`questions`, and optionally `state`) on stdin. |

`--state` takes a file, `-` for stdin, or the text itself.
The output gives the probability of each answer and a confidence from 0 to 1.
When the confidence is low, Claude treats the answer as a weak signal.

## Check a decision of yours

When you give a technical decision, Claude checks it with `decision.json` before it acts.

1. Jev sets `kind` to `preference` or `facts`.
1. For `preference`, Claude follows your decision and says nothing.
1. Jev gives `sound` from 0 (causes defects) to 2 (sound).
1. When `kind` is `facts` and `sound` is under 1, with confidence of 0.5 or more for each, Claude tells you once.
   It gives the facts, the risk, and a better alternative, and asks you to confirm or change the decision.
1. Your answer is final.

## Cost and limits

| Item | Value |
| --- | --- |
| Price | $0.042 for each million input tokens |
| Size of a call | Up to 64,000 tokens |

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The command exits with code 2 | `TYPESAFE_API_KEY` is not set. | Export the key, and restart Claude Code. Claude continues without Jev. |
| Error `TypeSafe API 401` | The key is not valid. | Get a new key. |
| No pick on a question | The question has fewer than 2 options, is a preference, or has confidence under 0.5. | None. |

## Related pages

- [Install](Install)
- [Guards](Guards)
