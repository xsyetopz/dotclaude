# Prompt hooks on Stop (history)

0.26.0 used a classic hook with `"type": "prompt"` on `Stop` for its checks rule, and it had removed the same hook on `SubagentStop`, because each call sends the transcript, about 46k tokens in the mean.
0.27.0 has neither hook.
The facts below stay as evidence for a later prompt hook.

## Facts from the binary

These facts are from the Claude Code 2.1.292 binary (**binary**), read only:

- Claude Code sends the hook `prompt` as a condition, after the words "has the following stopping condition been satisfied? Answer based on transcript evidence only."
  Stop and SubagentStop get their own system prompt for this.
- The model is the hook `model` field, else `ANTHROPIC_SMALL_FAST_MODEL`, else Haiku in most setups.
- The default timeout is 30 seconds.
- The answer schema is `ok`, `reason`, and `impossible`, and `ok` and `reason` are required.
  An `ok: false` answer on Stop or SubagentStop blocks, and Claude gets the reason and continues.
  With `impossible: true`, the stop goes through.
- The next stop in the turn has `stop_hook_active: true`.
- A timeout, an API error, invalid JSON, or a schema failure does not block, so the hook fails open.
- Claude Code ends the turn after 8 consecutive blocks from Stop hooks, and shows a warning.
  `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` changes the cap, and a value of 0 or less removes it.
- Each query loop keeps its own count of blocks, and a subagent runs its own loop.
  The count goes back to 0 when Claude calls a tool.
  At the cap, Claude Code shows the warning only for the main agent.

## Live tests

These facts are from live tests of 2.1.292 in `just sandbox` with Haiku 4.5 (**tested**):

- A `"type": "prompt"` hook in a plugin `hooks.json` runs on Stop and on SubagentStop.
  The 2.1.0 changelog added prompt hooks from plugins.
  The bug in [issue #13155](https://github.com/anthropics/claude-code/issues/13155) does not occur on 2.1.292.
- The evaluator model is `claude-haiku-4-5`.
  It gets the transcript, and `$ARGUMENTS` in the prompt becomes the hook input JSON.
- On a block, Claude gets `Stop hook feedback:`, then the full hook prompt in square brackets, then the `reason`.
  The prompt in this text has `$ARGUMENTS`, not the hook input.
  Thus a long prompt adds its full length to the context at each block, and Claude reads each rule of the prompt, also the rules that let a message through.
  Keep the prompt short, and write it as a rule that Claude can read.
- The model writes its own `reason`, and does not copy a sample reason from the prompt.
- A SubagentStop hook that always blocks blocked a subagent 8 times.
  At the 9th block, the subagent ended, and the main agent got no warning.
  The main agent had no block before, so the test does not show that the two counts are separate.
- The prompt of the checks rule had about 1,150 characters when it was tested.
  In one run of each of 7 sample reports, it gave the correct result for 6:
  - It let through a report that skipped a step at the request of the user.
  - It let through a report with a passing check, and a report with a **Not verified** list.
  - It blocked a report that called a fix done, apart from a flaky test.
  - It blocked a report that called a slice done with 1 failed test from another agent.
  - It blocked a report that called a fix done and also put the fix under **Not verified**.
  - It blocked an open item that "may already be done", although the prompt lets such an item through.
    The rule to block when the model is not sure is the probable cause.
- At the next stop, `stop_hook_active` was `true`, and the hook let the stop through.
- On 2026-10-07, the retry after a block repeated the claim "Done, all tests pass" with no test run, and the hook let it through.
  The same message with `stop_hook_active: false` was blocked in 3 of 3 runs.
  Thus the rule "If `stop_hook_active` is `true`, return {"ok": true}" lets one retry through.
  This is a known limit, and the rule stays, because it stops a loop of blocks.
- On 2026-10-07, a message that only asked the user for approval got `ok: false` with a reason that found no break.
  In 3 more runs of the same stop, and in 4 replays of the prompt, each answer was `ok: true`.
- Claude Code puts the prompt after this text: "Based on the conversation transcript above, has the following stopping condition been satisfied? Answer based on transcript evidence only."
  Thus the evaluator model judges a "stopping condition" and also sees the transcript.
  The probable cause of the false block is that the model judged whether the task of the user was complete, and not the claims of the message.
  This cause is not verified.
  The replays with `-p` had no such text and no transcript, so they did not show the false block.
- On 2026-10-07, 10 runs of each prompt version in the sandbox, on `claude-haiku-4-5`, gave these false blocks on a message that asked for approval:

  | Prompt version | False blocks, first stops | False blocks, retries |
  | --- | --- | --- |
  | Old prompt, 1,859 characters | 2 of 10 | 1 |
  | "Met, unless …" wording | 5 of 10 | 0 |
  | Stopping condition, 1,498 characters | 0 of 10 | 0 of 7 |

- The new prompt states the rule as the stopping condition, and says that the condition is about the claims in `last_assistant_message`.
  A question, a plan, a request for approval, or a report of open work satisfies it.
  A **Not verified** part satisfies it only with the reason that its check cannot run.
  The `reason` tells the agent to run the check and to fix the part until the check passes, and does not offer the **Not verified** list as an exit.
- With the new prompt, 2 messages that said "Done, add.js is fixed and all tests pass" with no check were both blocked.
  In 3 more runs, the agent only asked for approval to write the file, and the hook correctly let the stop through.
  The sample of true positives is small.

The [hooks doc](https://code.claude.com/docs/en/hooks) says that the count goes back to 0 at each tool call.
The [environment variables doc](https://code.claude.com/docs/en/env-vars) says that the cap applies to Stop and SubagentStop hooks.

## Related pages

- [Claude mods](Claude-Mods)
- [Design](Design)
