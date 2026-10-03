// The commands that a project names for its tests, from the first source that has one:
// a `justfile` recipe, a `package.json` script, a command in `CLAUDE.md` or `AGENTS.md`,
// or a build file of an ecosystem whose checks the ledger counts (`_check-command.mjs`).
// A build file can show that the project has tests but not which command runs them,
// for example a `pyproject.toml` with no pytest config.
// Then the result has no commands: the verify gate applies, and subagents get no command.
// Each source is a file at the project root, so the lookup costs a few reads.
// It reaches files only through `io`, because the hooks module has no `node:*`.

import { pathFor } from "./_path.mjs";

const RECIPE = /^@?(test|check)(?:[ \t][^\n:]*)?:(?!=)/gm;
const RUNNER =
  /^(just|make|npm|pnpm|yarn|bun|bunx|npx|deno|cargo|go|uv|uvx|poetry|pytest|tox|nox|bundle|rake|mix|gradle|\.\/gradlew|mvn|dotnet|swift|ctest|composer)\s/;
const TEST_WORD = /\b(test|tests|check)\b/;
const NO_TEST = /no test specified/;

/** The text of a file, or "" when it is missing or cannot be read. */
async function text(io, file) {
  try {
    return await io.fs.read(file);
  } catch {
    return "";
  }
}

async function justRecipes(io, root) {
  const path = pathFor(io.platform);
  for (const name of ["justfile", "Justfile", ".justfile"]) {
    const recipes = new Set(
      [...(await text(io, path.join(root, name))).matchAll(RECIPE)].map(
        (m) => m[1],
      ),
    );
    if (recipes.size)
      return {
        source: name,
        commands: ["test", "check"]
          .filter((r) => recipes.has(r))
          .map((r) => `just ${r}`),
      };
  }
  return null;
}

async function packageTest(io, root) {
  const path = pathFor(io.platform);
  let pkg;
  try {
    pkg = JSON.parse(await text(io, path.join(root, "package.json")));
  } catch {
    return null;
  }
  const script = pkg?.scripts?.test;
  if (typeof script !== "string" || NO_TEST.test(script)) return null;
  const has = (f) => io.fs.exists(path.join(root, f));
  const runner =
    (await has("bun.lock")) || (await has("bun.lockb"))
      ? "bun run test"
      : (await has("pnpm-lock.yaml"))
        ? "pnpm test"
        : (await has("yarn.lock"))
          ? "yarn test"
          : "npm test";
  return { source: "package.json", commands: [runner] };
}

/** The first command in backticks or a code block that runs tests. */
async function instructionCommand(io, root, fits) {
  const path = pathFor(io.platform);
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const doc = await text(io, path.join(root, name));
    const fenced = [...doc.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].flatMap(
      (m) => m[1].split("\n"),
    );
    const inline = [...doc.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
    const command = [...inline, ...fenced]
      .map((c) => c.trim().replace(/^\$\s+/, ""))
      .find((c) => fits(c) && RUNNER.test(c) && TEST_WORD.test(c));
    if (command) return { source: name, commands: [command] };
  }
  return null;
}

// Build files at the project root, and the test commands that each one implies.
// `text` reads a file at the root.
const BUILD_FILES = [
  { match: /^Cargo\.toml$/, commands: async () => ["cargo test"] },
  { match: /^go\.mod$/, commands: async () => ["go test ./..."] },
  {
    match: /^(GNUmakefile|[Mm]akefile)$/,
    commands: async (name, text) => {
      const targets = new Set(
        [...(await text(name)).matchAll(RECIPE)].map((m) => m[1]),
      );
      return ["test", "check"]
        .filter((t) => targets.has(t))
        .map((t) => `make ${t}`);
    },
    // A Makefile with no test target can build only, so it names no tests.
    needsCommand: true,
  },
  { match: /^tox\.ini$/, commands: async () => ["tox"] },
  { match: /^noxfile\.py$/, commands: async () => ["nox"] },
  { match: /^pytest\.ini$/, commands: async () => ["pytest"] },
  {
    match: /^(pyproject\.toml|setup\.cfg|setup\.py)$/,
    commands: async (name, text) =>
      /^\[tool[.:]pytest/m.test(await text(name)) ? ["pytest"] : [],
  },
  {
    match: /^(build|settings)\.gradle(\.kts)?$/,
    commands: async (_name, _text, names) => [
      names.has("gradlew") ? "./gradlew test" : "gradle test",
    ],
  },
  {
    match: /^pom\.xml$/,
    commands: async (_name, _text, names) => [
      names.has("mvnw") ? "./mvnw test" : "mvn test",
    ],
  },
  {
    match: /\.(sln|slnx|csproj|fsproj|vbproj)$/,
    commands: async () => ["dotnet test"],
  },
  // A CMake project runs `ctest` in its build directory, which the root does not name.
  { match: /^CMakeLists\.txt$/, commands: async () => [] },
  { match: /^meson\.build$/, commands: async () => [] },
  {
    match: /^(MODULE\.bazel|WORKSPACE(\.bazel)?)$/,
    commands: async () => ["bazel test //..."],
  },
  { match: /^build\.zig$/, commands: async () => ["zig build test"] },
  { match: /^Package\.swift$/, commands: async () => ["swift test"] },
  { match: /^mix\.exs$/, commands: async () => ["mix test"] },
  { match: /^deno\.jsonc?$/, commands: async () => ["deno test"] },
  {
    match: /^pubspec\.yaml$/,
    commands: async (name, text) => [
      /^\s+sdk:\s*flutter\b/m.test(await text(name))
        ? "flutter test"
        : "dart test",
    ],
  },
  {
    match: /^Gemfile$/,
    commands: async (name, text) => {
      const gems = await text(name);
      if (/\brspec\b/.test(gems)) return ["bundle exec rspec"];
      return /\b(minitest|test-unit)\b/.test(gems)
        ? ["bundle exec rake test"]
        : [];
    },
  },
  {
    match: /^composer\.json$/,
    commands: async (name, text) => {
      let pkg;
      try {
        pkg = JSON.parse(await text(name));
      } catch {
        return [];
      }
      if (typeof pkg?.scripts?.test === "string") return ["composer test"];
      return pkg?.["require-dev"]?.["phpunit/phpunit"]
        ? ["vendor/bin/phpunit"]
        : [];
    },
  },
];

/** The first build file at `root` that shows tests, with its commands. */
async function buildFile(io, root) {
  const path = pathFor(io.platform);
  let entries;
  try {
    entries = await io.fs.list(root);
  } catch {
    return null;
  }
  const names = new Set(
    entries.filter((e) => e.kind === "file").map((e) => e.name),
  );
  const read = (name) => text(io, path.join(root, name));
  for (const rule of BUILD_FILES)
    for (const name of [...names].sort()) {
      if (!rule.match.test(name)) continue;
      const commands = await rule.commands(name, read, names);
      if (commands.length || !rule.needsCommand)
        return { source: name, commands };
    }
  return null;
}

/**
 * `{ source, commands }` for the project at `root`, or null when it shows no tests.
 * `commands` is empty when a build file shows tests but not the command that runs them.
 * `fits` rejects a command from `CLAUDE.md` or `AGENTS.md`.
 */
export async function findTestCommand(io, root, fits = () => true) {
  return (
    (await justRecipes(io, root)) ??
    (await packageTest(io, root)) ??
    (await instructionCommand(io, root, fits)) ??
    (await buildFile(io, root))
  );
}
