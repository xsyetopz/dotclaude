# Terms of Use

Each note that dotclaude or one of its plugins gives to an agent is a clause of the dotclaude Terms of Use.
The user installs dotclaude, and with it accepts these terms for each session.
At session start, the agent gets the `dotclaude_terms_of_use` block, which says that each clause is a rule of the user.
Each note comes in a `dotclaude_terms` tag with the number and the title of its clause.
An enforced clause has a hook that denies, asks about, or changes a call that breaks the clause.
`hooks/lib/_terms.mjs` holds the list, and a test compares this page with it.

| Clause | Title | Note | Enforced by |
| --- | --- | --- | --- |
| 1 | Working rules | `working_rules`, at session start | The guards and the `verify` Stop hook |
| 2 | Minimal code | `minimal_code`, at session start, unless the `ponytail` option is off | Not enforced |
| 3 | Git attribution | `git_attribution`, at session start in a git repository | The Bash guard: a deny of a Claude trailer that the settings leave out, and an ask in a repository of another owner |
| 4 | API plan | `claude_plan`, at session start on the API plan | Not enforced |
| 5 | Cold cache | `cold_cache`, at a resume or a prompt after the cache expired | Not enforced |
| 6 | Handoff notes | `handoff` and `compaction_handoff_note` | Not enforced |
| 7 | Compaction | `open_request`, in the summary instruction | Not enforced |
| 8 | CodeGraph call paths | The call paths after a symbol search | Not enforced |
| 9 | Web browser (dotclaude-browser) | The browser skill and backend, at session start | Not enforced |
| 10 | Second opinion (dotclaude-jev) | `second_opinion`, at session start | The hooks module of the plugin: when `TYPESAFE_API_KEY` is set, it asks Jev about each `AskUserQuestion` question, and adds the pick of Jev to a question that facts decide |

A deny reason of an enforced clause names the clause.
A clause that is not enforced has no hook that can see a break of it, such as code that is larger than it needs to be.
