# Attributions

dotclaude uses ideas from the projects below. Both projects use the MIT
license. dotclaude copies no code from them. Each part below is a new
implementation.

| Project | Idea | dotclaude part |
| --- | --- | --- |
| [DensePack](https://github.com/Fabian-Galvez/DensePack) by Fabian-Galvez | `plugin/scripts/edit_gate.py`: when an `Edit` fails, show the lines that are closest to `old_string` | none: 0.20.0 removed `show-closest-lines.mjs`, the part that reimplemented it |
| [agent-skills](https://github.com/addyosmani/agent-skills) by Addy Osmani | a skill description that says what the skill does and when to use it | the "Use" part of each skill and agent description, and a "Not for" part where a neighbor can match the same request |

dotclaude adopts none of the workflow skills of these projects. The
[xsyetopz/skills](https://github.com/xsyetopz/skills) collection already
covers those workflows.
