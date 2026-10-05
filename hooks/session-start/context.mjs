// SessionStart: adds context. A resumed session with an expired prompt cache
// and a large context gets the cost advice. A new, cleared, or compacted session gets the working
// rules and the minimal code rules, and a new or cleared one also gets the
// pointer to the newest open handoff note.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COLD_RESUME_MIN_TOKENS } from "../lib/_budget.mjs";
import { resumeNote } from "../lib/_cache.mjs";
import { newestOpen, pointer } from "../lib/_handoff.mjs";
import { accountFrom, claudeJsonPath, detectPlan } from "../lib/_plan.mjs";

/** The plan from the environment and the account in `.claude.json`. */
function localPlan(env = { HOME: os.homedir(), ...process.env }) {
  let text = "";
  try {
    text = fs.readFileSync(claudeJsonPath(env), "utf8");
  } catch {}
  return detectPlan(env, accountFrom(text));
}

const RULES = path.join(import.meta.dirname, "rules.md");
// The idea of Ponytail (github.com/DietrichGebert/ponytail, MIT) in our words.
const MINIMAL_CODE = path.join(import.meta.dirname, "minimal-code.md");

function notesIn(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => ({
        name,
        text: fs.readFileSync(path.join(dir, name), "utf8"),
      }));
  } catch {
    return [];
  }
}

// Only the API plan changes a decision: its prompt cache lives 5 minutes.
const API_NOTE =
  "<claude_plan>\nThe plan is pay-per-token API, so the prompt cache lives 5 minutes.\nA pause of more than 5 minutes makes the next prompt write the whole context again.\nBefore a long wait, finish the step or write a handoff note.\n</claude_plan>";

/**
 * The context parts for the SessionStart input `data`. The plugin option
 * `ponytail` comes as `CLAUDE_PLUGIN_OPTION_PONYTAIL`, and only "false"
 * turns the minimal code rules off.
 */
export function contextFor(
  data,
  root,
  plan = localPlan(),
  ponytail = process.env.CLAUDE_PLUGIN_OPTION_PONYTAIL,
) {
  if (data.source === "resume")
    return data.prompt_cache_likely_expired === true &&
      !(Number(data.context_tokens) < COLD_RESUME_MIN_TOKENS)
      ? [resumeNote(data)]
      : [];
  if (!["startup", "clear", "compact"].includes(data.source)) return [];
  const parts = [
    `<working_rules>\n${fs.readFileSync(RULES, "utf8").trim()}\n</working_rules>`,
  ];
  if (ponytail !== "false")
    parts.push(
      `<minimal_code>\n${fs.readFileSync(MINIMAL_CODE, "utf8").trim()}\n</minimal_code>`,
    );
  if (plan === "api") parts.push(API_NOTE);
  const open =
    data.source === "compact"
      ? undefined
      : newestOpen(notesIn(path.join(root, ".claude", "handoffs")));
  if (open) parts.push(pointer(open));
  return parts;
}

if (import.meta.main) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    // No input: no context.
  }
  const root = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
  const parts = contextFor(data, root);
  if (parts.length)
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: parts.join("\n\n"),
        },
      }),
    );
}
