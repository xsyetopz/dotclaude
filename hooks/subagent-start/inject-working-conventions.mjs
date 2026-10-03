// SubagentStart: give subagents the core working conventions. Output styles
// reach only the main conversation, so subagents get this short version. The
// hooks module runs it in `agent.spawn`, so a resume (no spawn) gets no copy.
// The conventions name the project test command when `_test-command.mjs`
// finds one at the project root. An agent that cannot edit files gets
// `READ_ONLY`, with no fix or check lines. This file reaches files only
// through `io`, because the hooks module has no `node:*`.

import { definition, reserve } from "../lib/_agents.mjs";
import {
  handbackChars,
  k,
  LIMITS,
  subagentContextTokens,
} from "../lib/_budget.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import { findTestCommand } from "../lib/_test-command.mjs";

const CHECK_CLAIMS = `Claims in your brief are hypotheses.
Check them in the code, the installed source, or a run.
Finish all of the brief and nothing more.`;

const REPORT = `Put code items in backticks.
Give the answer first, then what changed, what ran, and what is open.
</working_conventions>`;

export const GUIDANCE_START = `<working_conventions>
${CHECK_CLAIMS}
Reproduce a reported bug before you fix it.
Report defects outside the brief to the parent.
The working tree is shared, so keep changes that are not yours.
A denied action is final.
After a code change, run a check that exercises it`;

export const GUIDANCE_END = `.
Fix a failing test at its cause.
Claude Code refuses a subagent's write to a \`.md\` file named \`report*\`, \`summary*\`, \`findings*\`, or \`analysis*\` (#44657).
Use another name.
${REPORT}`;

export const READ_ONLY = `<working_conventions>
${CHECK_CLAIMS}
A denied action is final.
${REPORT}`;

// Room for the command text, because the block goes to every subagent start.
const ROOM =
  LIMITS.sessionNoteChars.fail -
  (GUIDANCE_START + GUIDANCE_END).replace(/<\/?working_conventions[^>]*>/g, "")
    .length;
const fragment = (commands) =>
  `, such as ${commands.map((c) => `\`${c}\``).join(" or ")}`;

async function conventions(io, data, def) {
  if (def?.readOnly) return READ_ONLY;
  return GUIDANCE_START + (await testCommand(io, data)) + GUIDANCE_END;
}

async function testCommand(io, data) {
  const found = await findTestCommand(
    io,
    projectRoot(io, data),
    (c) => fragment([c]).length <= ROOM,
  );
  if (!found) return "";
  let { commands } = found;
  while (fragment(commands).length > ROOM) commands = commands.slice(0, -1);
  return commands.length ? fragment(commands) : "";
}

// The read-only reviewer's own prompt sets a different report format.
const OWN_PROMPT = new Set(["reviewer"]);

// An agent cut off at its turn limit delivers no report, so it is told the
// limit, and enforce-agent-budget refuses tool calls near it.
function budget(io, limit) {
  const cutoff = option(io.env, "usage_agent_bounds")
    ? `With ${reserve(limit)} left, a hook refuses tool calls, and your next action is your report.\nPlan to finish before then`
    : `When about ${reserve(limit)} remain, stop and write your report`;
  return `<turn_budget>\nYou have at most ${limit} turns.\n${cutoff}.\nIf work remains, make the report a handoff, because a fresh agent continues from it, not you.\nInclude what is done and how you verified it, and the files you changed.\nInclude anything half-edited, and what is left in order.\n</turn_budget>`;
}

// Every subagent, of any type, is refused tool calls past its context bound.
const context = (agentType) =>
  `<context_budget>\nEvery turn reads your whole context again.\nOnce it passes about ${k(subagentContextTokens(agentType))} tokens, a hook refuses tool calls, and your next action is your report.\nTo stay under it, read files by line range.\nKeep command output short.\nUse what you already read instead of reading it again.\n</context_budget>`;

// enforce-agent-budget refuses the first report above this limit once.
const report = (agentType) =>
  `<report_budget>\nThe main conversation reads your report again on each of its later turns.\nKeep the report at ${handbackChars(agentType)} characters or less.\nGive the outcome, the changed files, the check results, the parts that you did not verify, and the open items.\nLeave out the steps that you did and the full output of commands.\nIf you can write files, put a long handoff or long detail in a file under \`.claude/handoffs/\`, and give its path in the report.\n</report_budget>`;

// Anthropic's Sonnet 5 prompting guide: it "does not silently generalize an
// instruction from one item to another", most of all at lower effort. The
// Sonnet 5.5 guide keeps Sonnet 5 prompts, and says that at `low` effort it
// sometimes reports a change as done without a check that exercises it. In one
// user's 35-task test, Sonnet 5.5 wrote outside its assigned folder 4 times and
// Opus 5.5 0 times, mostly scratch files.
export const SONNET = `<scope_note>
Apply each instruction in your brief to everything it covers, not only the first match or file.
Name in your report anything you left out and why.
Write only in the files and directories that your brief names.
Put scratch files in the system temp folder, and delete them before you report, because files outside the brief make the review larger.
Report defects outside your brief instead of fixing them.
Before you report a code change as done, run a check that exercises it: the project's tests, type-checker, or build, or the changed command.
A syntax-only check, or a check command that did not start, is not a check.
If no real check can run, name the check that you did not run and why.
</scope_note>`;

export default async function (io, data) {
  if (!option(io.env, "agent_guidance")) return;
  const agentType = String(data.agent_type ?? "");
  const type = agentType.replace(/^dotclaude:/, "");
  const def = await definition(io, agentType);
  const parts = OWN_PROMPT.has(type) ? [] : [await conventions(io, data, def)];
  if (def?.maxTurns) parts.push(budget(io, def.maxTurns));
  if (option(io.env, "usage_agent_bounds"))
    parts.push(context(agentType), report(agentType));
  if (/sonnet/.test(def?.model ?? "")) parts.push(SONNET);
  if (!parts.length) return;
  return {
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext: parts.join("\n"),
    },
  };
}
