# Terms of Use

Each note that dotclaude or one of its plugins gives to an agent is a clause of the dotclaude Terms of Use.
This page lists the 18 clauses and the hook that enforces each one.

## How the terms work

- The user installs dotclaude, and with it accepts these terms for each session.
- At session start, the agent gets the `dotclaude_terms_of_use` block.
  It says that each clause is a rule of the user.
- Each note comes in a `dotclaude_terms` tag with the number and the title of its clause.
- An enforced clause has a hook that denies, asks about, or changes a call that breaks the clause.
- `plugins/dotclaude/lib/terms.mjs` holds the list, and a test compares this page with it.

## Clauses

| Clause | Title | Note | Enforced by |
| --- | --- | --- | --- |
| 1 | Working rules | `working_rules`, at session start | The guards |
| 2 | Minimal code | `minimal_code`, at session start, unless the `ponytail` option is off | Not enforced |
| 3 | Git attribution | `git_attribution`, at session start in a git repository | The Bash guard ([details](#clause-3)) |
| 4 | API plan | `claude_plan`, at session start on the API plan | Not enforced |
| 5 | Cold cache | `cold_cache`, at a resume or a prompt after the cache expired | Not enforced |
| 6 | Handoff notes | `handoff` and `compaction_handoff` | Not enforced |
| 7 | Compaction | `open_request`, in the summary instruction | Not enforced |
| 8 | CodeGraph call paths | The call paths after a symbol search | Not enforced |
| 9 | Web browser (dotclaude-browser) | The browser skill and backend, at session start | Not enforced |
| 10 | Second opinion (dotclaude-jev) | `second_opinion`, at session start | The `dotclaude-jev` module ([details](#clause-10)) |
| 11 | Line breaks | `line_breaks`, after a commit, `gh` message, `Write`, or `Edit` with prose that breaks at a column | The sembr hook ([details](#clause-11)) |
| 12 | CodeGraph index | `codegraph_index`, at session start in a git repository without a CodeGraph index, unless the `codegraph` option is off | The Bash guard ([details](#clause-12)) |
| 13 | Long runs | `long_runs`, at session start | Not enforced |
| 14 | Project AI policy | `project_ai_policy`, at session start, at the start of each subagent, and after a fetch from a GitHub repository with a policy file, unless the `guard_policy` option is off | The policy guard ([details](#clause-14)) |
| 15 | Subagent progress | `subagent_progress`, at session start and at the start of each subagent | Not enforced |
| 16 | Questions to the user | `user_questions`, at session start | A Stop hook ([details](#clause-16)) |
| 17 | Game modding (dotclaude-modder) | `game_modding`, at session start | The `dotclaude-modder` module ([details](#clause-17)) |
| 18 | Known defects | `known_defects`, at session start and at the start of each subagent | A Stop hook and a SubagentStop hook ([details](#clause-18)) |

A deny reason of an enforced clause names the clause.
A clause that is not enforced has no hook that can see a break of it, such as code that is larger than it needs to be.

## Enforcement detail

### Clause 3

- The Bash guard denies a Claude trailer that the settings leave out.
- In a repository of another owner, it asks instead.

### Clause 10

- The hooks module of `dotclaude-jev` works when `TYPESAFE_API_KEY` is set.
- It asks Jev about each `AskUserQuestion` question.
- It adds the pick of Jev to a question that facts decide.

### Clause 11

- The sembr hook rewraps the message of a `git commit`, `gh pr`, or `gh issue` command.
- After a `Write` or `Edit`, it gives the fixed text.

### Clause 12

- The Bash guard asks before `codegraph init` and `codegraph uninit`.

### Clause 14

- The policy guard asks before the first call of a session that reaches a project of another owner with a policy file.
- The ask comes before the call, so the user sees the policy before any code arrives.
- It covers GitHub fetches and local clones, not other hosts.
- It does not deny.

### Clause 16

- The Stop hook blocks the end of a turn when one of the last 3 prose lines of the last message ends in a question mark.
- It skips code blocks, inline code, headings, and quotes.
- It blocks only once in a row, so Claude can end a turn whose question is not to the user.

### Clause 17

- The hooks module of `dotclaude-modder` denies a Bash call that stops processes by name or by pattern.
- It finds `pkill`, `killall`, `taskkill /IM`, `Stop-Process -Name`, and `kill` with `pgrep`.
- The deny reason tells Claude to stop one process by its PID with `um win kill <pid>`.

### Clause 18

- A prompt hook on Stop and on SubagentStop sends the last message to the background model of Claude Code.
- The model blocks a message that calls a part done that no check passed on.
  For example, a check of the part did not run, failed, is flaky, or is pre-existing.
  It also blocks a done claim next to a failed-test count that is not 0.
- A **Not verified** list, open items, and a skipped step that is not a check do not count.
  A progress report that calls each part written or still running, and says that its checks are still to run, does not count.
  A part under **Not verified** that the message also calls done is a break.
- When the model is not sure, it blocks, because a missed failure looks like finished work.
- The hook blocks only once in a row.
- The reason tells Claude to fix the part, or to list it as not verified and not call it done.
  Claude Code also shows the full hook prompt to Claude with the reason, so the prompt is short and reads as the rule.
- [Claude mods](Claude-Mods) gives the test results on Claude Code 2.1.292.

## Related pages

- [Parts](Parts) shows the hook of each clause and its bound.
- [Guards](Guards) tells how each guard asks and denies.
- [Options](Options) lists the options that turn a note off.
