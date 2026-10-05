# Attributions

dotclaude uses ideas from the projects below.
dotclaude copies no code from them.
Each part below is a new implementation.
DensePack, agent-skills, Ponytail, and the `jev` CLI use the MIT license.
GitNexus uses the PolyForm Noncommercial license, so dotclaude uses only its design and no code or text.

| Project | Idea | dotclaude part |
| --- | --- | --- |
| [DensePack](https://github.com/Fabian-Galvez/DensePack) by Fabian-Galvez | `plugin/scripts/edit_gate.py`: when an `Edit` fails, show the lines that are closest to `old_string` | none: 0.20.0 removed `show-closest-lines.mjs`, the part that reimplemented it |
| [agent-skills](https://github.com/addyosmani/agent-skills) by Addy Osmani | a skill description that says what the skill does and when to use it | the "Use" part of each skill and agent description, and a "Not for" part where a neighbor can match the same request |
| [Ponytail](https://github.com/DietrichGebert/ponytail) by DietrichGebert | an order of steps that builds the minimum code: no code, reuse, the standard library, one line, then the minimum | `plugins/dotclaude/templates/context/minimal-code.md`, in our own STE text, and the `ponytail` option |
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) by abhigyanpatwari | hooks that add code graph context to the searches that the agent already runs | the CodeGraph augment in `plugins/dotclaude/hooks/module/index.mjs` and `plugins/dotclaude/lib/notes/codegraph.mjs` |
| [`jev` CLI](https://gist.github.com/pedramamini/014676fa8684d91bf7000f4623701ada) by pedramamini | short verbs (`yes`, `pick`, `rate`, `ask`) over the TypeSafe API, and keys in place of list positions | `plugins/dotclaude-jev/skills/second-opinion/scripts/jev.mjs` |

dotclaude adopts none of the workflow skills of these projects.
The [xsyetopz/skills](https://github.com/xsyetopz/skills) collection already covers those workflows.
