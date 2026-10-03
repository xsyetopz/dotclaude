// `checkCommand` finds the check inside a command, so the stop and task
// gates know that a test, build, or lint ran.

import { expect, test } from "bun:test";
import { CHECK, checkCommand } from "../../hooks/lib/_ledger.mjs";

const CHECKS = [
  ["swift test", "swift test"],
  ["xcrun swift test", "xcrun swift test"],
  ["env -u TOOLCHAINS DEVELOPER_DIR=/x xcrun swift build", "xcrun swift build"],
  ["xcrun --sdk macosx swift test", "xcrun --sdk macosx swift test"],
  ["xcrun xcodebuild -scheme App test", "xcrun xcodebuild -scheme App test"],
  ["just", "just"],
  ["just check", "just check"],
  ["just validate", "just validate"],
  [
    "just skills skill-lint markdown 2>&1 | grep x",
    "just skills skill-lint markdown",
  ],
  ["(just fmt; just test-unit) 2>&1 | rg y", "just test-unit"],
  ["make ci-local", "make ci-local"],
  ["node --test", "node --test"],
  [
    'node --test slug.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"',
    "node --test slug.test.mjs",
  ],
  [
    "ls && node --test-reporter=dot --test a.test.mjs",
    "node --test-reporter=dot --test a.test.mjs",
  ],
  ["./gradlew check", "gradlew check"],
  [
    "./gradlew -q :sharedUI:jvmTest --tests X",
    "gradlew -q :sharedUI:jvmTest --tests X",
  ],
  ["./gradlew spotlessApply detekt", "gradlew spotlessApply detekt"],
  ["./mvnw verify", "mvnw verify"],
  ["bunx --bun markdownlint-cli2 a.md", "bunx --bun markdownlint-cli2 a.md"],
  [
    "npx --no-install markdownlint-cli2 a.md",
    "npx --no-install markdownlint-cli2 a.md",
  ],
  ["bun run release:check", "bun run release:check"],
  [
    "swift-format lint --strict -r Sources",
    "swift-format lint --strict -r Sources",
  ],
  ["xcrun swift-format lint -r .", "xcrun swift-format lint -r ."],
  ["./scripts/check-localizations.sh -v", "check-localizations.sh -v"],
  ["sh verify.sh", "sh verify.sh"],
  ["python3 tools/check.py", "python3 tools/check.py"],
  ["python3 scripts/ste-lint.py a.md", "python3 scripts/ste-lint.py a.md"],
  ["cd app && ojd check schemas", "ojd check schemas"],
  ["ojd build dev", "ojd build dev"],
  ["./swiftpm.sh test --filter A", "swiftpm.sh test --filter A"],
  [
    "X=/tmp/s/x27.sh; $X swift build --build-tests 2>&1 | grep -E error",
    "x27.sh swift build --build-tests",
  ],
  ["/tmp/s/xc27.sh swift test --skip-build", "xc27.sh swift test --skip-build"],
  [
    "S=/tmp/s; zsh $S/x27.sh swift-format lint --strict Sources",
    "zsh /tmp/s/x27.sh swift-format lint --strict Sources",
  ],
];

const NOT_CHECKS = [
  "make clean",
  "just fmt",
  "just install",
  "xcrun simctl list",
  "swift package resolve",
  "node script.mjs --test",
  "node --test-reporter=dot app.mjs",
  "./gradlew :desktopApp:run",
  "./gradlew run --args=--test",
  "npm install lint-staged",
  "bun run dev",
  "npx --yes prettier --write .",
  "swift-format format -i a.swift",
  "bash scripts/latest.sh",
  "python3 build.py",
  "sh checkout.sh",
  "./x27.sh swift-format format -i a.swift",
  "zsh run.sh git status",
  "ojd catalog regenerate",
  "git check-ignore x",
  "gh run view --log",
  "brew test x",
  "rg test",
  "mkdir build",
  "echo check",
];

for (const [command, found] of CHECKS)
  test(`check: ${command}`, () => expect(checkCommand(command)).toBe(found));

for (const command of NOT_CHECKS)
  test(`not a check: ${command}`, () =>
    expect(checkCommand(command)).toBeUndefined());

// Each entry of `CHECK` has a string here, so that a change to one entry
// shows in a test.
const SAMPLES = [
  "pytest -q",
  "python3 -m pytest",
  "uv run pytest",
  "npm test",
  "npm t",
  "bun test",
  "bunx tsc --noEmit",
  "eslint .",
  "claude plugin validate .",
  "cargo test",
  "go vet ./...",
  "golangci-lint run",
  "rspec",
  "deno check main.ts",
  "shellcheck a.sh",
  "flutter test",
  "dotnet test",
  "ctest",
  "bazel test //...",
  "zig build",
  ...CHECKS.map(([command]) => command),
];

test("each CHECK entry matches at least one sample", () => {
  const joined = SAMPLES.map((command) => checkCommand(command) ?? "");
  const unmatched = CHECK.filter((re) => !joined.some((j) => re.test(j)));
  expect(unmatched.map(String)).toEqual([]);
});
