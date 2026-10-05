// SessionStart: adds context. A resumed session with an expired prompt cache
// and a large context gets the cost advice. A new, cleared, or compacted session gets the working
// rules, the long-run rules, and the minimal code rules, and a new or cleared one also gets the
// pointer to the newest open handoff note. A session in a git repository also
// gets the git attribution note, and the CodeGraph init note when the
// repository has no index. At startup, the user gets a note when the
// setup differs from the profile of this plugin version.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COLD_RESUME_MIN_TOKENS } from "../../lib/budget.mjs";
import {
  attributionNote,
  LOGIN_ARGV,
  linesOf,
  mergeSettings,
  ORGS_ARGV,
  OTHER_OWNER_NOTE,
  ownRepo,
  settingsPaths,
} from "../../lib/guards/attribution.mjs";
import { resumeNote } from "../../lib/notes/cache.mjs";
import { initNote } from "../../lib/notes/codegraph.mjs";
import { newestOpen, pointer } from "../../lib/notes/handoff.mjs";
import { accountFrom, claudeJsonPath, detectPlan } from "../../lib/plan.mjs";
import {
  LAUNCHERS,
  launcherText,
  mergeProfile,
  profileFor,
  staleSetupNote,
  withClaudeMdBlock,
} from "../../lib/setup/diff.mjs";
import { clause, TERMS_OF_USE } from "../../lib/terms.mjs";

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

const PLUGIN_ROOT = path.join(import.meta.dirname, "..", "..");
const TEMPLATES = path.join(PLUGIN_ROOT, "templates");
const RULES = path.join(TEMPLATES, "context", "working-rules.md");
// The idea of Ponytail (github.com/DietrichGebert/ponytail, MIT) in our words.
const MINIMAL_CODE = path.join(TEMPLATES, "context", "minimal-code.md");
const LONG_RUNS = path.join(TEMPLATES, "context", "long-runs.md");

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
 * turns the minimal code rules off. The option `codegraph` turns the
 * CodeGraph index note off in the same way.
 */
export function contextFor(
  data,
  root,
  plan = localPlan(),
  ponytail = process.env.CLAUDE_PLUGIN_OPTION_PONYTAIL,
  codegraph = process.env.CLAUDE_PLUGIN_OPTION_CODEGRAPH,
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
  parts.push(
    clause(
      "long-runs",
      `<long_runs>\n${fs.readFileSync(LONG_RUNS, "utf8").trim()}\n</long_runs>`,
    ),
  );
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
  if (codegraph !== "false" && needsIndex(root)) parts.push(initNote(root));
  return parts;
}

/** True when `root` is a git repository without a CodeGraph index, and `codegraph` runs. */
export function needsIndex(root, exec = run) {
  return (
    fs.existsSync(path.join(root, ".git")) &&
    !fs.existsSync(path.join(root, ".codegraph")) &&
    exec(["codegraph", "--version"], root) !== null
  );
}

/**
 * The note to the user at startup when the user settings, the `CLAUDE.md`
 * block, or the status line launchers differ from the setup profile, or null. The note shows once for each
 * plugin version, so a value that the user keeps on purpose does not show
 * again until the next update. A missing or bad file gives no note.
 */
export function setupNotice(
  configDir = process.env.CLAUDE_CONFIG_DIR ||
    path.join(os.homedir(), ".claude"),
  plan = localPlan(),
) {
  const read = (file) => fs.readFileSync(file, "utf8");
  const mark = path.join(configDir, "dotclaude", "setup-noticed");
  try {
    const { version } = JSON.parse(
      read(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json")),
    );
    if (fs.existsSync(mark) && read(mark).trim() === version) return null;
    const settingsFile = path.join(configDir, "settings.json");
    const settings = fs.existsSync(settingsFile)
      ? JSON.parse(read(settingsFile))
      : {};
    const profile = profileFor(
      JSON.parse(read(path.join(TEMPLATES, "settings.json"))),
      plan,
    );
    const claudeMdFile = path.join(configDir, "CLAUDE.md");
    const claudeMd = fs.existsSync(claudeMdFile) ? read(claudeMdFile) : "";
    const body = read(path.join(TEMPLATES, "CLAUDE.md.block"));
    // A status line of another tool does not run a launcher in `stubs`.
    const stubs = path.join(configDir, "dotclaude");
    const launchers = LAUNCHERS.filter(([key, stub, script]) => {
      if (!String(settings[key]?.command ?? "").includes(stubs)) return false;
      const file = path.join(stubs, stub);
      const text = launcherText(path.join(PLUGIN_ROOT, "status-line", script));
      return !fs.existsSync(file) || read(file) !== text;
    });
    const note = staleSetupNote(
      version,
      mergeProfile(settings, profile).changes,
      withClaudeMdBlock(claudeMd, body).text !== claudeMd,
      launchers.length,
    );
    if (note) {
      fs.mkdirSync(path.dirname(mark), { recursive: true });
      fs.writeFileSync(mark, `${version}\n`);
    }
    return note;
  } catch {
    return null;
  }
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
  const notice = data.source === "startup" ? setupNotice() : null;
  if (parts.length || notice)
    process.stdout.write(
      JSON.stringify({
        ...(notice && { systemMessage: notice }),
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: parts.join("\n\n"),
        },
      }),
    );
}
