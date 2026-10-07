# Terms of Use

Each note that dotclaude or one of its plugins gives to an agent is a rule of the dotclaude operating spec.
Release 0.26.0 replaced the 18 clauses of the earlier Terms of Use with the spec.
[Operating spec](Operating-Spec) lists each section and rule with its number, level, and hook.
This page tells how the spec reaches an agent and how each hook enforces a rule.

## How the spec works

- The user installs dotclaude, and with it accepts the spec for each session.
- A context note comes in a `dotclaude_spec` tag with the number and the title of its section.
- A rule has the number `section.rule`, such as 12.1.
  A deny reason or a hook prompt that cites a rule says "This is rule 12.1 of the dotclaude operating spec."
- A rule with a hook has that hook deny, ask about, or change a call that breaks the rule.
  A rule with no hook has no hook that can see a break of it, such as code that is larger than it needs to be.
- `plugins/dotclaude/lib/terms.mjs` holds the list.
  The other plugins cannot import it, so each writes its section as text, and a test compares that text with the list.

| Who | Gets | From |
| --- | --- | --- |
| The main agent | Sections 1, 8, 11, and 12, and section 2 unless the option `ponytail` is `false` | The `SessionStart` hook, for a new, cleared, or compacted session |
| A subagent | Section 10, with the path of its progress file | The `SubagentStart` hook |
| The agent that makes the call | The policy section, with the policy file | The `PreToolUse` hook, when it asks about a call that reaches a project with a policy file |

- The `SessionStart` hook leaves rules 1.7 and 11.1 out, because a hook gives a `late` rule when a call breaks it.
- A subagent gets no section except section 10 from its start hook.
- The hooks and plugins that give the other sections, such as 4 to 7 and 13 to 15, are not in this table.

## Enforcement detail

### Rules 3.1 and 3.2

- The Bash guard denies a Claude trailer that the settings leave out.
- In a repository of another owner, it asks instead.

### Rule 6.2

- The Bash guard asks before `codegraph init` and `codegraph uninit`.

### Rule 7.1

- The sembr hook rewraps the message of a `git commit`, `gh pr`, or `gh issue` command.
- After a `Write` or `Edit`, it gives the fixed text.

### Rule 9.1

- The policy guard asks before the first call of a session that reaches a project of another owner with a policy file.
- The ask comes before the call, so the user sees the policy before any code arrives.
- It covers GitHub fetches and local clones, not other hosts.
- It does not deny.

### Rule 11.1

- The Stop hook blocks the end of a turn when one of the last 3 prose lines of the last message ends in a question mark.
- It skips code blocks, inline code, headings, and quotes.
- It blocks only once in a row, so Claude can end a turn whose question is not to the user.

### Section 14

- The hooks module of `dotclaude-jev` works when `TYPESAFE_API_KEY` is set.
- It asks Jev about each `AskUserQuestion` question.
- It adds the pick of Jev to a question that facts decide.

### Rule 15.3

- The hooks module of `dotclaude-modder` denies a Bash call that stops processes by name or by pattern.
- It finds `pkill`, `killall`, `taskkill /IM`, `Stop-Process -Name`, and `kill` with `pgrep`.
- The deny reason tells Claude to stop one process by its PID with `um win kill <pid>`.

### Rule 12.1

- `terms.mjs` gives rule 12.1 no `hook` field.
  A prompt hook on `Stop` in `plugins/dotclaude/hooks/hooks.json` cites it.
- The hook sends the transcript and the last message to the background model of Claude Code.
  Claude Code cuts the transcript at half of the context window of that model.
- No hook checks the last message of a subagent, because each call costs about as much as the transcript.
  The main agent compares each "done" in a subagent report with the check output (rule 8.3).
- The model blocks a message that calls a part done that no check passed on.
  For example, a check of the part did not run, failed, is flaky, or is pre-existing.
  It also blocks a done claim next to a failed-test count that is not 0.
- A part that the message calls open, not verified, not checked, or still running does not count.
  A claim of another agent that the message says it did not check, a run whose results it did not read, a part that is only written or started, and a skipped step that is not a check also do not count.
  A part that the message also calls done in its own words is a break.
  A claim of another agent that the message repeats with no such words is a done claim of the message, and so is a prompt for the next session in the message.
- The model blocks only when it can quote the words of the done claim, because a false block makes Claude change a correct message.
- The hook blocks only once in a row.
- The reason tells Claude to fix the part, or to list it as not verified and not call it done.
  Claude Code also shows the full hook prompt to Claude with the reason, so the prompt is short and reads as the rule.
- [Claude mods](Claude-Mods) gives the test results on Claude Code 2.1.292.

## Related pages

- [Operating spec](Operating-Spec) lists each section and rule.
- [Parts](Parts) shows the hook of each part and its bound.
- [Guards](Guards) tells how each guard asks and denies.
- [Options](Options) lists the options that turn a note off.
