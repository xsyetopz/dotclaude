// `checkCommand` finds the check inside a command, so the stop and task
// gates know that a test, build, or lint ran.

import { expect, test } from "bun:test";
import { checkCommand } from "../../hooks/lib/_ledger.mjs";

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
];

const NOT_CHECKS = [
  "make clean",
  "just fmt",
  "just install",
  "xcrun simctl list",
  "swift package resolve",
  "node script.mjs --test",
  "node --test-reporter=dot app.mjs",
];

for (const [command, found] of CHECKS)
  test(`check: ${command}`, () => expect(checkCommand(command)).toBe(found));

for (const command of NOT_CHECKS)
  test(`not a check: ${command}`, () =>
    expect(checkCommand(command)).toBeUndefined());
