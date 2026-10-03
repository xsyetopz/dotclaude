// Subagent start guidance injection.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HANDBACK_CHARS,
  HANDBACK_FINDINGS_CHARS,
  k,
  LIMITS,
  REVIEWER_CONTEXT_TOKENS,
  SUBAGENT_CONTEXT_TOKENS,
} from "../../hooks/lib/_budget.mjs";
import { hook } from "../support/hooks.mjs";

const CONVENTIONS = "<working_conventions>";

/** The text of the `<tag>` block, or undefined. */
function block(text, tag) {
  return text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
}

/** The whole numbers a block states, in order. */
const numbers = (text) => (text ?? "").match(/\d+/g)?.map(Number) ?? [];

test("subagent guidance is injected, skipped for the reviewer, and can be turned off", () => {
  const out = hook("subagent-start/inject-working-conventions.mjs", {
    hook_event_name: "SubagentStart",
    agent_id: "a1",
    agent_type: "general-purpose",
  });
  expect(out.hookSpecificOutput.hookEventName).toBe("SubagentStart");
  const context = out.hookSpecificOutput.additionalContext;
  expect(context).toContain(CONVENTIONS);
  expect(block(context, "working_conventions")?.trim()).toBeTruthy();
  // Every subagent start carries this block, so it stays short.
  expect(block(context, "working_conventions").length).toBeLessThanOrEqual(
    LIMITS.sessionNoteChars.fail,
  );
  expect(context).not.toMatch(/turn_budget/);
  expect(block(context, "context_budget")).toContain(
    k(SUBAGENT_CONTEXT_TOKENS),
  );
  const start = (agentType) =>
    hook("subagent-start/inject-working-conventions.mjs", {
      hook_event_name: "SubagentStart",
      agent_type: agentType,
    }).hookSpecificOutput.additionalContext;
  // Every dotclaude agent learns its turn limit; the ones with their own
  // prompt get only that.
  const implementer = start("dotclaude:implementer");
  expect(implementer).toContain(CONVENTIONS);
  // The limit from the agent file, then the turns kept for the report.
  const implementerBudget = numbers(block(implementer, "turn_budget"));
  expect(implementerBudget).toContain(80);
  expect(implementerBudget).toContain(4);
  const reviewer = start("dotclaude:reviewer");
  expect(reviewer).not.toContain(CONVENTIONS);
  expect(numbers(block(reviewer, "turn_budget"))).toContain(60);
  expect(block(reviewer, "context_budget")).toContain(
    k(REVIEWER_CONTEXT_TOKENS),
  );
  // The report limit that enforce-agent-budget applies.
  expect(numbers(block(implementer, "report_budget"))).toContain(
    HANDBACK_CHARS,
  );
  expect(numbers(block(reviewer, "report_budget"))).toContain(
    HANDBACK_FINDINGS_CHARS,
  );
  // The read-only investigator keeps the conventions and the common bound,
  // with no lines about fixes or checks, because it cannot edit files.
  const investigator = start("dotclaude:investigator");
  expect(investigator).toContain(CONVENTIONS);
  expect(block(investigator, "working_conventions")).not.toMatch(
    /\bfix\b|run a check/i,
  );
  expect(block(implementer, "working_conventions")).toMatch(/fix it/);
  expect(numbers(block(investigator, "turn_budget"))).toContain(40);
  expect(block(investigator, "context_budget")).toContain(
    k(SUBAGENT_CONTEXT_TOKENS),
  );
  expect(
    hook(
      "subagent-start/inject-working-conventions.mjs",
      { hook_event_name: "SubagentStart", agent_type: "Explore" },
      { CLAUDE_PLUGIN_OPTION_AGENT_GUIDANCE: "false" },
    ),
  ).toBe(null);
});

/** The conventions block for a project root that holds `files`. */
function conventionsIn(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-tests-"));
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), text);
  const out = hook(
    "subagent-start/inject-working-conventions.mjs",
    {
      hook_event_name: "SubagentStart",
      agent_type: "general-purpose",
      cwd: dir,
    },
    { CLAUDE_PROJECT_DIR: dir },
  );
  fs.rmSync(dir, { recursive: true });
  return block(out.hookSpecificOutput.additionalContext, "working_conventions");
}

/** The commands that the conventions line for the check names. */
const testCommands = (conventions) =>
  [
    ...(conventions.match(/^After a code change.*$/m)?.[0] ?? "").matchAll(
      /`([^`]+)`/g,
    ),
  ].map((m) => m[1]);

test("the conventions name the project test command from the project root", () => {
  const justfile = conventionsIn({
    justfile:
      'dir := "tests"\n\n# Lint\nlint:\n    biome ci .\n\ntest *args:\n    bun test "$@"\n\n@check: lint test\n',
    "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
  });
  // A justfile recipe comes before the package.json script.
  expect(testCommands(justfile)).toEqual(["just test", "just check"]);
  expect(justfile.length).toBeLessThanOrEqual(LIMITS.sessionNoteChars.fail);

  // A justfile with no test or check recipe gives no command.
  expect(
    testCommands(
      conventionsIn({
        justfile: "build:\n    make\n",
        "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
        "bun.lock": "{}",
      }),
    ),
  ).toEqual(["bun run test"]);
  expect(
    testCommands(
      conventionsIn({
        "package.json": JSON.stringify({ scripts: { test: "jest" } }),
      }),
    ),
  ).toEqual(["npm test"]);

  // The placeholder script of `npm init` is not a test command.
  const placeholder = conventionsIn({
    "package.json": JSON.stringify({
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
    }),
    "CLAUDE.md":
      "# App\n\n- `src/` holds the code.\n- `cargo test --workspace` runs the tests.\n",
  });
  expect(testCommands(placeholder)).toEqual(["cargo test --workspace"]);

  // A command longer than the block's limit would make the block too long.
  const long = `go test ./... -run '${"x".repeat(LIMITS.sessionNoteChars.fail)}'`;
  expect(
    testCommands(
      conventionsIn({ "CLAUDE.md": `Run \`${long}\` or \`go test ./...\`.\n` }),
    ),
  ).toEqual(["go test ./..."]);

  expect(
    testCommands(
      conventionsIn({
        "AGENTS.md": "## Test\n\n```sh\n$ uv run pytest -q tests\n```\n",
      }),
    ),
  ).toEqual(["uv run pytest -q tests"]);

  const none = conventionsIn({ "README.md": "Run `make`.\n" });
  expect(testCommands(none)).toEqual([]);
  expect(none).toContain(
    "run a check that exercises it.\nFix a failing test at its cause.",
  );
});

test("the conventions name the test command that a build file implies", () => {
  const cases = [
    [{ "Cargo.toml": "[package]\n" }, ["cargo test"]],
    [{ "go.mod": "module x\n" }, ["go test ./..."]],
    [{ Makefile: "build:\n\tcc a.c\ntest: build\n\t./a\n" }, ["make test"]],
    [{ "tox.ini": "[tox]\n" }, ["tox"]],
    [{ "pyproject.toml": "[tool.pytest.ini_options]\n" }, ["pytest"]],
    [{ "setup.cfg": "[tool:pytest]\n" }, ["pytest"]],
    [{ "build.gradle.kts": "", gradlew: "" }, ["./gradlew test"]],
    [{ "pom.xml": "<project/>" }, ["mvn test"]],
    [{ "App.csproj": "<Project/>" }, ["dotnet test"]],
    [{ "MODULE.bazel": "" }, ["bazel test //..."]],
    [{ "build.zig": "" }, ["zig build test"]],
    [{ "Package.swift": "" }, ["swift test"]],
    [{ "mix.exs": "" }, ["mix test"]],
    [{ "deno.json": "{}" }, ["deno test"]],
    [
      { "pubspec.yaml": "dependencies:\n  flutter:\n    sdk: flutter\n" },
      ["flutter test"],
    ],
    [{ "pubspec.yaml": "name: x\n" }, ["dart test"]],
    [{ Gemfile: "gem 'rspec'\n" }, ["bundle exec rspec"]],
    [
      {
        "composer.json": JSON.stringify({
          "require-dev": { "phpunit/phpunit": "^11" },
        }),
      },
      ["vendor/bin/phpunit"],
    ],
    // A build file that does not show the command names none.
    [{ "pyproject.toml": "[project]\nname = 'x'\n" }, []],
    [{ "CMakeLists.txt": "project(x)\n" }, []],
    // A command in CLAUDE.md comes before a build file.
    [
      { "go.mod": "module x\n", "CLAUDE.md": "Run `go test -race ./...`.\n" },
      ["go test -race ./..."],
    ],
  ];
  for (const [files, commands] of cases)
    expect(
      testCommands(conventionsIn(files)),
      Object.keys(files).join(" "),
    ).toEqual(commands);
});
