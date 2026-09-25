// Per-session record of edits and check runs, used by the stop gate and the
// compaction carry-over. Stored under CLAUDE_PLUGIN_DATA, never in the repo.

import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./_common.mjs";
import { parse } from "./_shell.mjs";

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
  /^(npm|pnpm|yarn|bun) (run )?(test|build|lint|check|typecheck|type-check|tsc|verify|ci|e2e|test:\S+|lint:\S+|build:\S+)\b/,
  /^(npm|pnpm|yarn) (t|tst)$/,
  /^bun test\b/,
  /^(npx|pnpx|bunx|pnpm exec|yarn exec|pnpm dlx) (jest|vitest|tsc|eslint|biome|oxlint|playwright|mocha|ava|prettier --check|cypress run)\b/,
  /^(jest|vitest|mocha|ava|tsc|eslint|biome|oxlint|playwright test|cypress run)\b/,
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
