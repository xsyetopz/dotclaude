// Per-session record of edits and check runs, used by the stop gate and the
// compaction carry-over. Stored under CLAUDE_PLUGIN_DATA, never in the repo.

import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./_common.mjs";
import { parse } from "./_shell.mjs";

/** Files that are not code: editing them alone needs no test run. */
export const NON_CODE =
  /\.(md|mdx|markdown|txt|rst|adoc|org|csv|tsv|svg|png|jpe?g|gif|webp|ico|pdf|log)$/i;

function file(sessionId, agentId) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(
    stateDir(),
    `${safe(sessionId || "unknown")}${agentId ? `.${safe(agentId)}` : ""}.json`,
  );
}

export function load(sessionId, agentId) {
  try {
    return {
      seq: 0,
      lastEdit: null,
      lastCheck: null,
      blockedEdit: null,
      blockedCheck: null,
      prompts: [],
      ...JSON.parse(fs.readFileSync(file(sessionId, agentId), "utf8")),
    };
  } catch {
    return {
      seq: 0,
      lastEdit: null,
      lastCheck: null,
      blockedEdit: null,
      blockedCheck: null,
      prompts: [],
    };
  }
}

/** Paths edited by a session and all of its subagents. */
export function editedBySession(sessionId) {
  const prefix = file(sessionId, null).replace(/\.json$/, "");
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  const out = new Set();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (
      name !== `${base}.json` &&
      !(name.startsWith(`${base}.`) && name.endsWith(".json"))
    )
      continue;
    try {
      const state = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      for (const p of state.edited ?? []) out.add(p);
    } catch {
      // a ledger being rewritten; skip it
    }
  }
  return out;
}

export function save(sessionId, agentId, state) {
  const target = file(sessionId, agentId);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, target);
}

// Commands that test, build, lint or type-check. Matched against each simple
// command after wrappers are stripped.
const CHECK = [
  /^(pytest|py\.test|tox|nox|nose2|mypy|pyright|basedpyright|ruff check|ruff|pylint|flake8)\b/,
  /^python[0-9.]* -m (pytest|unittest|mypy|ruff|pyright|compileall|tox)\b/,
  /^(uv|poetry|pdm|hatch|rye) run (pytest|mypy|ruff|pyright|tox|python -m pytest)\b/,
  /^(npm|pnpm|yarn|bun) (run )?(test|build|lint|check|typecheck|type-check|tsc|verify|validate|ci|e2e|test:\S+|lint:\S+|build:\S+)\b/,
  /^(npm|pnpm|yarn) (t|tst)$/,
  /^bun test\b/,
  /^(npx|pnpx|bunx|pnpm exec|yarn exec|pnpm dlx) (jest|vitest|tsc|eslint|biome|oxlint|playwright|mocha|ava|prettier --check|cypress run|markdownlint(?:-cli2)?)\b/,
  /^(jest|vitest|mocha|ava|tsc|eslint|biome|oxlint|playwright test|cypress run|markdownlint(?:-cli2)?)\b/,
  /^claude plugin validate\b/,
  /^cargo (test|build|check|clippy|nextest|fmt --check|fmt -- --check)\b/,
  /^go (test|build|vet)\b/,
  /^(golangci-lint|staticcheck) run\b/,
  /^(make|gmake|just|task|mage)( (test|tests|check|build|lint|all|ci|verify)\S*)?$/,
  /^(swift (build|test)|xcodebuild\b.*\b(build|test))\b/,
  /^(\.\/gradlew|gradle|\.\/mvnw|mvn) .*\b(test|build|check|verify|assemble|compile)\b/,
  /^dotnet (build|test)\b/,
  /^(ctest|ninja|meson test|cmake --build)\b/,
  /^bazel(isk)? (test|build)\b/,
  /^zig (build|test)\b/,
  /^(mix (test|compile)|rspec|bundle exec (rspec|rake)|rake (test|spec)|phpunit|vendor\/bin\/phpunit|composer test)\b/,
  /^deno (test|check|lint)\b/,
  /^(shellcheck|clang-tidy|swiftlint|ktlint|hadolint|actionlint)\b/,
  /^(flutter|dart) (test|analyze)\b/,
];

export function isCheckCommand(command) {
  try {
    return parse(command).commands.some((cmd) => {
      const joined = [cmd.name, ...cmd.args].join(" ");
      return CHECK.some((re) => re.test(joined));
    });
  } catch {
    return false;
  }
}

// Failure markers in the output of a command that exited 0, for example
// `pytest | tail` where the pipe hides the exit code.
const FAILURE_OUTPUT =
  /\b[1-9]\d* (failed|failing|errors?)\b|^FAILED\b|^FAIL\b|\bTests?: +[1-9]\d* failed|\bBUILD FAILED\b|npm ERR!|\berror\[E\d+\]|\berror TS\d+|^error: could not compile|\bpanicked at\b|^Traceback \(most recent call last\)|\b[1-9]\d* problems? \(/m;

export function outputShowsFailure(text) {
  return FAILURE_OUTPUT.test(text);
}

// Shell commands that write files without the edit tools: redirects, tee,
// in-place editors, and interpreter code that opens a file for writing.
const IN_PLACE = /^(sed|gsed|perl)$/;
const INTERPRETER = /^(python[0-9.]*|node|bun|deno|ruby|perl)$/;
// Write calls in inline interpreter code whose first argument is a string
// literal: `open('f', 'w')`, `Path('f').write_text(`, `writeFileSync('f'`.
// The path argument: a plain, raw, or bytes string literal, or a variable that
// a simple assignment in the same code sets to one. f-strings and other
// computed paths are skipped, since their value is unknown.
const LITERAL = String.raw`\s*(?:[rRbBuU]?'([^'\\\n]*)'|[rRbBuU]?"([^"\\\n]*)"|([A-Za-z_]\w*)(?=\s*[,)]))`;
const ASSIGN =
  /(?:^|[\s;(])(?:const\s+|let\s+|var\s+)?([A-Za-z_]\w*)\s*=\s*[rRbBuU]?(?:'([^'\\\n]*)'|"([^"\\\n]*)")/gm;
const WRITE_CALLS = [
  [String.raw`\bopen\(`, String.raw`\s*,\s*(?:mode\s*=\s*)?["'][wax]`],
  [String.raw`\bPath\(`, String.raw`\s*\)\.write_(?:text|bytes)\(`],
  [String.raw`\bwriteFileSync\(`, ""],
  [String.raw`\bfs\.(?:promises\.)?writeFile\(`, ""],
  [String.raw`\bBun\.write\(`, ""],
  [String.raw`\bFile\.write\(`, ""],
  [String.raw`\b(?:os|ioutil)\.WriteFile\(`, ""],
].map(([call, rest]) => new RegExp(call + LITERAL + rest, "g"));

function inlineWrites(code) {
  const vars = new Map();
  for (const m of code.matchAll(ASSIGN)) vars.set(m[1], m[2] ?? m[3]);
  return WRITE_CALLS.flatMap((re) =>
    [...code.matchAll(re)].map((m) => m[1] ?? m[2] ?? vars.get(m[3])),
  ).filter((target) => target !== undefined);
}

const home = (p) => p.replace(/^~(?=\/|$)/, process.env.HOME ?? "~");

/**
 * Paths (relative to the project) of code files a Bash command writes, in
 * order, without duplicates. For inline interpreter code, the string-literal
 * path arguments of its write calls stand in for the targets. Relative targets
 * resolve against the directory an earlier `cd` in the command moved to.
 */
export function shellWrites(command, root, cwd = root) {
  const inProject = (target, base) => {
    if (!target || target.includes("$") || target.startsWith("/dev/"))
      return null;
    const abs = path.resolve(base, home(target));
    const rel = path.relative(root, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    if (NON_CODE.test(rel) || rel.startsWith(".claude/")) return null;
    return rel;
  };
  let parsed;
  try {
    parsed = parse(command);
  } catch {
    return [];
  }
  const out = new Set();
  for (const cmd of parsed.commands) {
    // An unresolvable `cd $DIR` leaves the base at cwd, as the bash guard does.
    const base =
      cmd.cwdHint && !cmd.cwdHint.includes("$")
        ? path.resolve(cwd, home(cmd.cwdHint))
        : cwd;
    const add = (targets) => {
      for (const t of targets) {
        const rel = inProject(t, base);
        if (rel) out.add(rel);
      }
    };
    add(cmd.writes);
    const operands = cmd.args.filter((a) => a && !a.startsWith("-"));
    if (
      IN_PLACE.test(cmd.name) &&
      cmd.args.some((a) => /^-[a-zA-Z]*i/.test(a))
    ) {
      // `sed -i '' 's/a/b/' f` and `perl -pi -e '...' f`: the first operand is
      // the script unless -e gave it, and only existing files count.
      const scriptGiven = cmd.args.some((a) => /^-[a-zA-Z]*e$/.test(a));
      add(
        operands
          .slice(scriptGiven ? 0 : 1)
          .filter((a) => fs.existsSync(path.resolve(base, a))),
      );
    }
    if (cmd.name === "sd") add(operands.slice(2));
    if (cmd.name === "tee") add(operands);
    if (["mv", "cp", "install"].includes(cmd.name) && operands.length > 1)
      add(operands.slice(-1));
    // Scratch files outside the project, such as in /tmp, are not edits.
    if (INTERPRETER.test(cmd.name))
      add(inlineWrites([cmd.heredoc ?? "", ...cmd.args].join("\n")));
  }
  return [...out];
}
