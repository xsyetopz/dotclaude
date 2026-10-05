// SessionStart: adds context. A resumed session with an expired prompt cache
// and a large context gets the cost advice. A new, cleared, or compacted session gets the working
// rules and the minimal code rules, and a new or cleared one also gets the
// pointer to the newest open handoff note. A session in a git repository also
// gets the git attribution note.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attributionNote,
  LOGIN_ARGV,
  linesOf,
  mergeSettings,
  ORGS_ARGV,
  OTHER_OWNER_NOTE,
  ownRepo,
  settingsPaths,
} from "../lib/_attribution.mjs";
import { COLD_RESUME_MIN_TOKENS } from "../lib/_budget.mjs";
import { resumeNote } from "../lib/_cache.mjs";
import { newestOpen, pointer } from "../lib/_handoff.mjs";
import { accountFrom, claudeJsonPath, detectPlan } from "../lib/_plan.mjs";
import { clause, TERMS_OF_USE } from "../lib/_terms.mjs";

/** The plan from the environment and the account in `.claude.json`. */
function localPlan(env = { HOME: os.homedir(), ...process.env }) {
  let text = "";
  try {
    text = fs.readFileSync(claudeJsonPath(env), "utf8");
  } catch {}
  return detectPlan(env, accountFrom(text));
}

/** The output of `argv` in `cwd`, or null when it fails. */
function run(argv, cwd) {
  try {
    const opts = { cwd, encoding: "utf8", stdio: "pipe", timeout: 3000 };
    return execFileSync(argv[0], argv.slice(1), opts).trim();
  } catch {
    return null;
  }
}

/**
 * The git attribution note for `root`, or null outside git. `run` and `env`
 * are parameters, so that tests can give fakes.
 */
export function gitNote(model, root, exec = run, env = process.env) {
  const remotes = exec(["git", "remote", "-v"], root);
  if (remotes === null) return null;
  const owners = linesOf(exec(LOGIN_ARGV, root));
  if (remotes && !ownRepo(remotes, owners) && owners.length)
    owners.push(...linesOf(exec(ORGS_ARGV, root)));
  if (remotes && !ownRepo(remotes, owners)) return OTHER_OWNER_NOTE;
  const config = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const texts = settingsPaths(config, root).map((file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return "";
    }
  });
  return attributionNote(model, mergeSettings(texts));
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
const API_NOTE = clause(
  "api-plan",
  "<claude_plan>\nThe plan is pay-per-token API, so the prompt cache lives 5 minutes.\nA pause of more than 5 minutes makes the next prompt write the whole context again.\nBefore a long wait, finish the step or write a handoff note.\n</claude_plan>",
);

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
    `${TERMS_OF_USE}\n\n${clause("working-rules", `<working_rules>\n${fs.readFileSync(RULES, "utf8").trim()}\n</working_rules>`)}`,
  ];
  if (ponytail !== "false")
    parts.push(
      clause(
        "minimal-code",
        `<minimal_code>\n${fs.readFileSync(MINIMAL_CODE, "utf8").trim()}\n</minimal_code>`,
      ),
    );
  if (plan === "api") parts.push(API_NOTE);
  const attribution = gitNote(data.model, root);
  if (attribution) parts.push(attribution);
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
