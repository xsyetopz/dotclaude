// Which simple commands test, build, lint, or type-check, so that the stop
// and task gates know that a check ran.
// A command counts in one of three ways:
// a tool form in `TOOLS`, a task runner with a task whose name has a check
// part, or a shape in `CHECK`.
// Launchers such as `npx`, `bundle exec`, and `docker run` are looked
// through first.
// Each check has a kind:
// `run` for a test, a build, a compile, a type-check, or a run of a program
// or notebook, and `static` for a lint or a format check.
// A type-checker is `run`, because it exercises the types of the code.
// A task with a name that this file does not know is `run`.

import { parse } from "./_shell.mjs";
import { program } from "./_shell-command.mjs";

// Tool forms that check, one for each form.
// The first word is the tool, and the next words are its subcommand.
// Words that start with `-` are flags, and the command must have one of them:
// `prettier --check|-c` counts with `--check` or with `-c`.
export const TOOLS = [
  // Python
  "pytest",
  "py.test",
  "tox",
  "nox",
  "nose2",
  "ward",
  "mypy",
  "dmypy run",
  "dmypy check",
  "pyright",
  "basedpyright",
  "pyre check",
  "pytype",
  "ruff check",
  "ruff format --check|--diff",
  "pylint",
  "flake8",
  "pycodestyle",
  "pydocstyle",
  "pyflakes",
  "bandit",
  "vulture",
  "black --check|--diff",
  "isort --check|--check-only|-c|--diff",
  "pip-audit",
  "deptry",
  "pre-commit run",
  "unittest",
  "compileall",
  "py_compile",
  "doctest",
  "coverage run",
  "hatch test",
  "hatch fmt --check",
  "rye test",
  "rye lint",
  "rye fmt --check",
  "django-admin test",
  "django-admin check",
  // JavaScript and TypeScript
  "jest",
  "vitest",
  "mocha",
  "ava",
  "tap",
  "tsc",
  "vue-tsc",
  "tsgo",
  "svelte-check",
  "astro check",
  "astro build",
  "nuxi typecheck",
  "nuxi build",
  "nuxt typecheck",
  "nuxt build",
  "eslint",
  "biome check",
  "biome lint",
  "biome ci",
  "biome format",
  "oxlint",
  "prettier --check|-c|--list-different|-l",
  "stylelint",
  "markdownlint",
  "markdownlint-cli2",
  "knip",
  "depcheck",
  "publint",
  "attw",
  "playwright test",
  "cypress run",
  "ng test",
  "ng build",
  "ng lint",
  "ng e2e",
  "next build",
  "next lint",
  "vite build",
  "webpack",
  "rollup",
  "tsup",
  "deno test",
  "deno check",
  "deno lint",
  "deno fmt --check",
  "dprint check",
  // Rust
  "cargo test",
  "cargo t",
  "cargo build",
  "cargo b",
  "cargo check",
  "cargo c",
  "cargo clippy",
  "cargo nextest",
  "cargo miri",
  "cargo deny",
  "cargo audit",
  "cargo hack",
  "cargo llvm-cov",
  "cargo tarpaulin",
  "cargo insta test",
  "cargo mutants",
  "cargo semver-checks",
  "cargo bench",
  "cargo machete",
  "cargo udeps",
  "cargo fmt --check",
  // Go and Protocol Buffers
  "go test",
  "go build",
  "go vet",
  "golangci-lint run",
  "staticcheck",
  "govulncheck",
  "gosec",
  "revive",
  "errcheck",
  "gofmt -l|-d",
  "goimports -l|-d",
  "gofumpt -l|-d",
  "gotestsum",
  "ginkgo",
  "buf lint",
  "buf build",
  "buf breaking",
  // JVM
  "ktlint",
  "detekt",
  "scala-cli compile",
  "scala-cli test",
  "scalafmt --test|--check",
  "clj-kondo",
  // Swift and Apple
  "swift build",
  "swift test",
  "swift format lint",
  "swift-format lint",
  "swiftlint",
  "swiftformat --lint",
  "swiftc -typecheck",
  "plutil -lint",
  "periphery scan",
  "tuist build",
  "tuist test",
  // .NET
  "dotnet build",
  "dotnet test",
  "dotnet format --verify-no-changes",
  "dotnet csharpier check",
  "dotnet csharpier --check",
  "csharpier check",
  "csharpier --check",
  // C, C++, and build systems
  "ctest",
  "ninja",
  "meson test",
  "meson compile",
  "cmake --build",
  "clang-tidy",
  "clang-format --dry-run|-n",
  "cppcheck",
  "cpplint",
  "bazel test",
  "bazel build",
  "bazelisk test",
  "bazelisk build",
  "buck2 test",
  "buck2 build",
  "pants test",
  "pants lint",
  "pants check",
  "zig build",
  "zig test",
  "zig fmt --check",
  // Ruby
  "rspec",
  "rubocop",
  "standardrb",
  "srb tc",
  "steep check",
  "rails test",
  "brakeman",
  "reek",
  // PHP
  "phpunit",
  "pest",
  "paratest",
  "phpstan",
  "psalm",
  "phpcs",
  "php-cs-fixer fix --dry-run",
  "php -l",
  "artisan test",
  // Elixir and Erlang
  "mix test",
  "mix compile",
  "mix credo",
  "mix dialyzer",
  "mix format --check-formatted",
  "rebar3 eunit",
  "rebar3 ct",
  "rebar3 dialyzer",
  "rebar3 compile",
  "rebar3 xref",
  // Haskell and OCaml
  "stack test",
  "stack build",
  "cabal test",
  "cabal build",
  "hlint",
  "dune build",
  "dune test",
  "dune runtest",
  // Dart and Flutter
  "flutter test",
  "flutter analyze",
  "flutter build",
  "dart test",
  "dart analyze",
  "dart format --set-exit-if-changed",
  // Other languages
  "crystal spec",
  "nimble test",
  "busted",
  "luacheck",
  "selene",
  "stylua --check",
  "bats",
  "shellcheck",
  "shfmt -d|-l|--diff|--list",
  // Nix
  "nix flake check",
  "nix build",
  "statix check",
  "deadnix",
  "alejandra --check",
  "nixfmt --check",
  // Infrastructure and config
  "terraform validate",
  "terraform fmt -check|--check",
  "tofu validate",
  "tofu fmt -check|--check",
  "tflint",
  "tfsec",
  "checkov",
  "hadolint",
  "actionlint",
  "yamllint",
  "kubeconform",
  "helm lint",
  "ansible-lint",
  "conftest test",
  "taplo check",
  "taplo lint",
  "taplo fmt --check",
  "check-jsonschema",
  "vale",
  // Security scans and hook runners
  "semgrep scan",
  "semgrep ci",
  "semgrep --config",
  "osv-scanner",
  "lefthook run",
  "trunk check",
  "claude plugin validate",
  // Proof assistants, hardware design, and embedded builds
  "lake build",
  "coqc",
  "verilator --lint-only",
  "iverilog",
  "yosys",
  "sby",
  "pio test",
  "pio run",
  "platformio test",
  "platformio run",
  "idf.py build",
  "west build",
  // Data and notebooks
  "dbt test",
  "dbt build",
  "sqlfluff lint",
  "jupyter nbconvert --execute",
];

// The forms of `TOOLS` that only read the code: a lint or a format check.
// All other forms are `run`.
export const STATIC_TOOLS = new Set([
  "pre-commit run",
  "go vet",
  "dart analyze",
  "flutter analyze",
  "ruff check",
  "ruff format --check|--diff",
  "pylint",
  "flake8",
  "pycodestyle",
  "pydocstyle",
  "pyflakes",
  "bandit",
  "vulture",
  "black --check|--diff",
  "isort --check|--check-only|-c|--diff",
  "pip-audit",
  "deptry",
  "hatch fmt --check",
  "rye lint",
  "rye fmt --check",
  "eslint",
  "biome check",
  "biome lint",
  "biome ci",
  "biome format",
  "oxlint",
  "prettier --check|-c|--list-different|-l",
  "stylelint",
  "markdownlint",
  "markdownlint-cli2",
  "knip",
  "depcheck",
  "publint",
  "attw",
  "ng lint",
  "next lint",
  "deno lint",
  "deno fmt --check",
  "dprint check",
  "cargo clippy",
  "cargo deny",
  "cargo audit",
  "cargo machete",
  "cargo udeps",
  "cargo semver-checks",
  "cargo fmt --check",
  "golangci-lint run",
  "staticcheck",
  "govulncheck",
  "gosec",
  "revive",
  "errcheck",
  "gofmt -l|-d",
  "goimports -l|-d",
  "gofumpt -l|-d",
  "buf lint",
  "buf breaking",
  "ktlint",
  "detekt",
  "scalafmt --test|--check",
  "clj-kondo",
  "swift format lint",
  "swift-format lint",
  "swiftlint",
  "swiftformat --lint",
  "plutil -lint",
  "periphery scan",
  "dotnet format --verify-no-changes",
  "dotnet csharpier check",
  "dotnet csharpier --check",
  "csharpier check",
  "csharpier --check",
  "clang-tidy",
  "clang-format --dry-run|-n",
  "cppcheck",
  "cpplint",
  "pants lint",
  "zig fmt --check",
  "rubocop",
  "standardrb",
  "brakeman",
  "reek",
  "phpcs",
  "php-cs-fixer fix --dry-run",
  "php -l",
  "mix credo",
  "mix format --check-formatted",
  "hlint",
  "dart format --set-exit-if-changed",
  "luacheck",
  "selene",
  "stylua --check",
  "shellcheck",
  "shfmt -d|-l|--diff|--list",
  "statix check",
  "deadnix",
  "alejandra --check",
  "nixfmt --check",
  "terraform validate",
  "terraform fmt -check|--check",
  "tofu validate",
  "tofu fmt -check|--check",
  "tflint",
  "tfsec",
  "checkov",
  "hadolint",
  "actionlint",
  "yamllint",
  "kubeconform",
  "helm lint",
  "ansible-lint",
  "conftest test",
  "taplo check",
  "taplo lint",
  "taplo fmt --check",
  "check-jsonschema",
  "vale",
  "semgrep scan",
  "semgrep ci",
  "semgrep --config",
  "osv-scanner",
  "trunk check",
  "claude plugin validate",
  "verilator --lint-only",
  "sqlfluff lint",
]);

const SPECS = new Map();
for (const spec of TOOLS) {
  const [tool, ...words] = spec.split(" ");
  if (!SPECS.has(tool)) SPECS.set(tool, []);
  SPECS.get(tool).push({
    sub: words.filter((w) => !w.startsWith("-")),
    flags: words.filter((w) => w.startsWith("-")).flatMap((w) => w.split("|")),
    kind: STATIC_TOOLS.has(spec) ? "static" : "run",
  });
}

/**
 * True when the words of `sub` follow the tool in `argv`, after flags and
 * their values only: `go -C app test` runs `go test`.
 */
function hasSub(argv, sub) {
  if (!sub.length) return true;
  for (let i = 1; i < argv.length; i++) {
    if (sub.every((w, k) => argv[i + k] === w)) return true;
    if (argv[i].startsWith("-")) continue;
    // A word after a flag can be the value of the flag.
    const prev = argv[i - 1];
    if (i > 1 && prev.startsWith("-") && !prev.includes("=")) continue;
    return false;
  }
  return false;
}

/** The kind of the tool form that `argv` matches, or undefined. */
function toolKind(argv) {
  const words = argv.slice(1).map((w) => w.split("=")[0]);
  const found = (SPECS.get(argv[0]) ?? []).filter(
    ({ sub, flags }) =>
      hasSub(argv, sub) &&
      (!flags.length || flags.some((f) => words.includes(f))),
  );
  if (!found.length) return undefined;
  return found.some((f) => f.kind === "run") ? "run" : "static";
}

/**
 * The kind of a `godot` run: only a headless run of a script or a parse
 * check is a check.
 * `--check-only` parses the script and does not run it.
 */
function godotKind(argv) {
  if (!/^godot[0-9.]*$/.test(argv[0])) return undefined;
  const words = argv.slice(1).map((w) => w.split("=")[0]);
  if (!words.includes("--headless")) return undefined;
  if (words.includes("--check-only")) return "static";
  return words.includes("--script") || words.includes("-s") ? "run" : undefined;
}

// Task names count by their parts:
// `test:unit`, `typeCheck`, and `ci-local` hold a check part.
const CHECK_PARTS = new Set([
  "test",
  "tests",
  "spec",
  "specs",
  "check",
  "checks",
  "lint",
  "lints",
  "build",
  "rebuild",
  "verify",
  "validate",
  "typecheck",
  "tsc",
  "ci",
  "e2e",
  "unit",
  "integration",
  "coverage",
  "analyze",
  "analyse",
]);
// A task with a fix part, such as `lint:fix`, changes files.
// It counts only with a part that checks the result, such as `format:check`.
const FIX_PARTS = new Set([
  "fix",
  "format",
  "fmt",
  "autofix",
  "autocorrect",
  "write",
  "apply",
]);
const DRY_PARTS = new Set(["check", "verify", "validate", "diff", "dry"]);

function parts(name) {
  return name
    .split(/[\s:_./-]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());
}

function checkTask(name, extra = []) {
  const ps = parts(name);
  if (ps.some((p) => FIX_PARTS.has(p))) return ps.some((p) => DRY_PARTS.has(p));
  return ps.some((p) => CHECK_PARTS.has(p) || extra.includes(p));
}

// A task with one of these parts and no run part only reads the code.
const STATIC_PARTS = new Set([
  "lint",
  "lints",
  "analyze",
  "analyse",
  "detekt",
  "spotless",
  "checkstyle",
  "ktlint",
  "pmd",
  "spotbugs",
]);
const RUN_PARTS = new Set([
  "test",
  "tests",
  "spec",
  "specs",
  "build",
  "rebuild",
  "typecheck",
  "tsc",
  "e2e",
  "unit",
  "integration",
  "coverage",
]);

/** `static` for a lint task or a format check, `run` for all other tasks. */
function taskKind(name) {
  const ps = parts(name);
  if (ps.some((p) => RUN_PARTS.has(p))) return "run";
  if (ps.some((p) => STATIC_PARTS.has(p))) return "static";
  if (ps.some((p) => FIX_PARTS.has(p))) return "static";
  return "run";
}

const JVM_PARTS = ["compile", "assemble", "detekt", "checkstyle", "ktlint"];

// Task runners, with the flags that take a value.
// `bare` runners run a default task, which is a check in most projects.
// `extra` holds more check parts for the tool.
// `run` is the subcommand before the task names, and `one` means that only
// the first name is a task and the words after it are its arguments.
const RUNNERS = {
  make: {
    values: [
      "-C",
      "--directory",
      "-f",
      "--file",
      "--makefile",
      "-I",
      "-o",
      "-W",
    ],
    bare: true,
    extra: ["all"],
  },
  just: {
    values: [
      "-f",
      "--justfile",
      "-d",
      "--working-directory",
      "--set",
      "--shell",
      "--dotenv-path",
      "--dotenv-filename",
    ],
    bare: true,
  },
  task: {
    values: ["-d", "--dir", "-t", "--taskfile", "-o", "--output"],
    bare: true,
  },
  mage: { values: ["-d", "-w", "-t"], bare: true },
  rake: {
    values: ["-f", "--rakefile", "-C", "--directory", "-I", "-r", "--require"],
    bare: true,
  },
  invoke: { values: ["-c", "--collection", "-r", "--search-root"] },
  gulp: { values: ["-f", "--gulpfile", "--cwd"] },
  grunt: { values: ["--gruntfile", "--base"] },
  poe: { values: ["-C", "--directory", "--root"], one: true },
  turbo: {
    values: [
      "-F",
      "--filter",
      "--scope",
      "--concurrency",
      "--cache-dir",
      "--output-logs",
      "--log-order",
      "--env-mode",
      "--cwd",
      "--log-prefix",
      "--cache",
    ],
  },
  lerna: {
    run: "run",
    values: ["--scope", "--ignore", "--concurrency", "--since"],
  },
  rush: {
    values: [
      "-t",
      "--to",
      "-T",
      "--to-except",
      "-f",
      "--from",
      "-o",
      "--only",
      "-i",
      "--impacted-by",
      "-p",
      "--parallelism",
    ],
  },
  rushx: { values: [], one: true },
  mise: {
    run: ["run", "r"],
    values: ["-C", "--cd", "-j", "--jobs", "-o", "--output"],
  },
  pixi: {
    run: "run",
    values: ["-e", "--environment", "--manifest-path"],
    one: true,
  },
  hatch: { run: "run", values: [], one: true },
  rye: { run: "run", values: [], one: true },
  devbox: { run: "run", values: ["-c", "--config", "-e", "--env"], one: true },
  composer: {
    run: ["run", "run-script"],
    optional: true,
    values: ["-d", "--working-dir"],
    one: true,
  },
  deno: { run: "task", values: ["--cwd", "-c", "--config"], one: true },
  gradle: {
    values: [
      "-p",
      "--project-dir",
      "-b",
      "--build-file",
      "-c",
      "--settings-file",
      "-x",
      "--exclude-task",
      "-g",
      "--gradle-user-home",
      "-I",
      "--init-script",
      "--tests",
      "--console",
      "--warning-mode",
      "--max-workers",
    ],
    extra: JVM_PARTS,
    goal: true,
  },
  mvn: {
    values: [
      "-pl",
      "--projects",
      "-f",
      "--file",
      "-P",
      "--activate-profiles",
      "-s",
      "--settings",
      "-T",
      "--threads",
      "-rf",
      "--resume-from",
    ],
    extra: ["compile", "package", "install"],
    goal: true,
  },
  sbt: { values: [], extra: JVM_PARTS },
  mill: { values: [], extra: JVM_PARTS },
  lein: { values: [], extra: JVM_PARTS },
  ant: { values: ["-f", "-buildfile", "-file"], extra: JVM_PARTS },
};
RUNNERS.gmake = RUNNERS.make;
RUNNERS.inv = RUNNERS.invoke;
RUNNERS.gradlew = RUNNERS.gradle;
RUNNERS.mvnw = RUNNERS.mvn;

// Flags that do not take a value, so the word after them is an action.
const XCODEBUILD_SWITCHES = new Set([
  "-quiet",
  "-verbose",
  "-json",
  "-allowProvisioningUpdates",
  "-allowProvisioningDeviceRegistration",
  "-skipPackagePluginValidation",
  "-skipMacroValidation",
  "-parallelizeTargets",
  "-hideShellScriptEnvironment",
  "-showBuildTimingSummary",
  "-disableAutomaticPackageResolution",
  "-onlyUsePackageVersionsFromResolvedFile",
]);

/** The non-flag words of `words` up to `--`, without flag values and `VAR=value` words. */
function names(words, takesValue) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "--") break;
    if (w.startsWith("-")) {
      if (!w.includes("=") && takesValue(w)) i++;
      continue;
    }
    if (!/^\w+=/.test(w)) out.push(w);
  }
  return out;
}

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
// `npm` runs a script without `run` only for these test commands.
const NPM_TESTS = new Set([
  "test",
  "t",
  "tst",
  "it",
  "install-test",
  "cit",
  "install-ci-test",
]);
// Subcommands that start a launcher, not a script.
const PM_LAUNCHERS = new Set(["exec", "dlx", "x"]);

/**
 * The task names that `argv` runs and the rules to classify them, or
 * undefined when `argv` is not a task runner.
 */
function tasks(argv) {
  const [name, ...rest] = argv;
  const [sub, ...more] = rest;
  if (PACKAGE_MANAGERS.has(name)) {
    if (sub === "run" || sub === "run-script")
      return { names: names(more, () => false).slice(0, 1) };
    if (name === "npm") return { names: NPM_TESTS.has(sub) ? ["test"] : [] };
    // `ci` is a clean install in each package manager.
    if (!sub || sub === "ci" || PM_LAUNCHERS.has(sub) || sub.startsWith("-"))
      return { names: [] };
    return { names: [sub] };
  }
  if (name === "nx") {
    if (sub === "run-many" || sub === "affected") {
      const out = [];
      for (let i = 0; i < more.length; i++) {
        const [flag, value] = more[i].split(/=(.*)/);
        if (!["-t", "--target", "--targets"].includes(flag)) continue;
        if (value !== undefined) out.push(...value.split(","));
        else
          for (let k = i + 1; k < more.length && !more[k].startsWith("-"); k++)
            out.push(...more[k].split(","));
      }
      return { names: out };
    }
    if (sub === "run")
      return { names: more[0]?.includes(":") ? [more[0].split(":")[1]] : [] };
    return { names: sub && !sub.startsWith("-") ? [sub] : [] };
  }
  if (name === "moon") {
    if (sub !== "run") return { names: sub ? [sub] : [] };
    return {
      names: names(more, () => false).map((t) =>
        t.slice(t.lastIndexOf(":") + 1),
      ),
    };
  }
  if (name === "cargo" && (sub === "make" || sub === "xtask"))
    return { names: names(more, () => false).slice(0, 1) };
  if (name === "xcodebuild")
    return {
      names: names(
        rest,
        (f) => !f.startsWith("--") && !XCODEBUILD_SWITCHES.has(f),
      ),
    };
  const runner = RUNNERS[name];
  if (!runner) return undefined;
  let words = rest;
  if (runner.run) {
    const runs = [runner.run].flat();
    if (runs.includes(sub)) words = more;
    // Other subcommands, such as `hatch test`, are tool forms.
    else if (!runner.optional) return undefined;
  }
  let found = names(words, (f) => runner.values.includes(f));
  // Only the last part of `:core:format:jvmTest` or `spotless:check` is the task.
  // The parts before it name a project or a plugin.
  if (runner.goal) found = found.map((t) => t.slice(t.lastIndexOf(":") + 1));
  return {
    names: runner.one ? found.slice(0, 1) : found,
    bare: runner.bare,
    extra: runner.extra,
  };
}

/** The kind of the check that a task runner runs, null for a runner with no check, or undefined for a command that is not a runner. */
function taskKindOf(argv) {
  const found = tasks(argv);
  if (!found) return undefined;
  // A quoted task such as `sbt "testOnly a.B"` holds its arguments.
  const list = found.names.map((n) => n.split(/\s+/)[0]);
  if (!list.length) return found.bare ? "run" : null;
  const checks = list.filter((n) => checkTask(n, found.extra));
  if (!checks.length) return null;
  return checks.some((n) => taskKind(n) === "run") ? "run" : "static";
}

// Command shapes that the tool forms do not cover.
// Each is matched against the words of a command, joined by spaces.
export const CHECK = [
  // Node's built-in runner.
  // Flags only before `--test`: `node app.mjs --test` runs app.mjs.
  /^node (-\S+ )*--test( |$)/,
  // A script with a check word as one part of its file name, run directly
  // or by an interpreter: `check-localizations.sh`, `python3 tools/check.py`.
  /^((ba|z)?sh |python[0-9.]* |bun |node )?(\S*\/)?([^\s/]*[-_.])?(check|verify|validate|test|lint)s?([-_.][^\s/]*)?\.(sh|bash|zsh|py|mjs|cjs|js|ts|rb|pl)( |$)/i,
  // A runner script in a test folder: `bash tests/run.sh`.
  /^((ba|z)?sh |python[0-9.]* |bun |node )?(\S*\/)?(tests?|spec)\/(run|all)[\w-]*\.(sh|bash|zsh|py|mjs|cjs|js|ts|rb|pl|lua)( |$)/i,
  // A project command with a check subcommand: `ojd check schemas`, `swiftpm.sh test`.
  // Tools that take a file, a pattern, or a word as their first argument
  // are not project commands.
  /^(?!(git|gh|brew|echo|printf|cd|ls|cat|less|head|tail|rg|grep|egrep|fgrep|tgrep|ag|ack|fd|find|tree|sed|sd|awk|jq|yq|wc|du|stat|file|touch|mkdir|rmdir|rm|cp|mv|ln|open|code|vim|nvim|nano|man|which|type|command|whereis|xargs|tee|test|diff|chmod|chown|tar|zip|unzip|curl|wget|tmux|kill|pkill|pgrep|ps|say|osascript|defaults|launchctl|plutil|codesign|openssl|security|pip|pip3|uv|docker|podman|kubectl) )\S+ (test|check|lint|verify|build|validate)( |$)/,
];

// Launchers that run the command after their words, their flags, and the
// number of positional words in the third item.
// The second item holds the flags that take a value.
const LAUNCHERS = [
  [["npx"], ["-p", "--package"]],
  [["pnpx"], []],
  [["bunx"], ["-p", "--package"]],
  [
    ["bun", "x"],
    ["-p", "--package"],
  ],
  [
    ["npm", "exec"],
    ["-p", "--package"],
  ],
  [["pnpm", "exec"], []],
  [["pnpm", "dlx"], ["--package"]],
  [["yarn", "exec"], []],
  [
    ["yarn", "dlx"],
    ["-p", "--package"],
  ],
  [["bundle", "exec"], []],
  [
    ["conda", "run"],
    ["-n", "--name", "-p", "--prefix", "--cwd"],
  ],
  [
    ["mamba", "run"],
    ["-n", "--name", "-p", "--prefix", "--cwd"],
  ],
  [
    ["micromamba", "run"],
    ["-n", "--name", "-p", "--prefix", "--cwd"],
  ],
  [["asdf", "exec"], []],
  [["direnv", "exec"], [], 1],
  [["rustup", "run"], [], 1],
  [
    ["devbox", "run"],
    ["-c", "--config", "-e", "--env"],
  ],
  [
    ["pixi", "run"],
    ["-e", "--environment", "--manifest-path"],
  ],
  [["hatch", "run"], []],
  [["rye", "run"], []],
  [["dotnet", "tool", "run"], []],
  [["xcrun"], ["--sdk", "-sdk", "--toolchain", "-toolchain"]],
  [["arch"], ["-arch"]],
];

// Launchers with flags that this file does not know.
// Each word after them can start the command that they run.
const OPEN_LAUNCHERS = [
  ["c8"],
  ["nyc"],
  ["docker", "run"],
  ["docker", "exec"],
  ["docker", "compose", "run"],
  ["docker", "compose", "exec"],
  ["docker-compose", "run"],
  ["docker-compose", "exec"],
  ["podman", "run"],
  ["podman", "exec"],
];

const INTERPRETER = /^(python[0-9.]*|node|php|ruby|perl)$/;

/** True when `argv` starts with `words`. */
const leads = (argv, words) => words.every((w, i) => argv[i] === w);

/** The commands that `argv` runs inside it. */
function inner(argv) {
  const out = [];
  const script = wrapped(argv);
  if (script) out.push(script);
  for (const [words, values, positional = 0] of LAUNCHERS) {
    if (!leads(argv, words)) continue;
    let i = words.length;
    while (i < argv.length && argv[i].startsWith("-")) {
      const flag = argv[i++];
      if (flag === "--") break;
      if (values.includes(flag)) i++;
    }
    out.push(argv.slice(i + positional));
  }
  for (const words of OPEN_LAUNCHERS) {
    if (!leads(argv, words)) continue;
    for (let i = words.length; i < argv.length; i++)
      if (!argv[i].startsWith("-")) out.push(argv.slice(i));
  }
  const [name, sub] = argv;
  if (name === "mise" && (sub === "exec" || sub === "x")) {
    const end = argv.indexOf("--");
    if (end !== -1) out.push(argv.slice(end + 1));
  }
  if (name === "nix" && (sub === "develop" || sub === "shell")) {
    const at = argv.findIndex((w) => w === "-c" || w === "--command");
    if (at !== -1) out.push(argv.slice(at + 1));
  }
  if (INTERPRETER.test(name ?? "")) {
    // `python -m pytest` runs `pytest`, and `php artisan test` runs `artisan test`.
    for (let i = 1; i < argv.length; i++) {
      const word = argv[i];
      if (word === "-m" && /^python/.test(name)) {
        out.push(argv.slice(i + 1));
        break;
      }
      if (!word.startsWith("-")) {
        if (i === 1) out.push(argv.slice(1));
        break;
      }
      if (word === "-W" || word === "-X") i++;
    }
  }
  return out.filter((a) => a.length);
}

/**
 * `argv` and each command that it runs inside it, with base names.
 * A package that a launcher runs loses its version: `@biomejs/biome@2` is `biome`.
 */
function forms(argv, depth = 0, out = []) {
  out.push(argv);
  if (depth < 4)
    for (const a of inner(argv))
      forms(
        [program(a[0]).replace(/(.)@[^@]*$/, "$1"), ...a.slice(1)],
        depth + 1,
        out,
      );
  return out;
}

// A project command or a script that names `lint` only reads the code.
const LINT_SHAPE = /^(\S+ )?(\S*[-_./])?lints?([-_.]\S*)?( |$)/i;

/** The kind of the check that `argv` is, `run` or `static`, or undefined. */
function kindOf(argv) {
  if (checksNothingHere(argv)) return undefined;
  const task = taskKindOf(argv);
  if (task !== undefined) return task ?? undefined;
  const tool = toolKind(argv) ?? godotKind(argv);
  if (tool) return tool;
  const joined = argv.join(" ");
  if (!CHECK.some((re) => re.test(joined))) return undefined;
  return LINT_SHAPE.test(joined) ? "static" : "run";
}

// A shell script that runs the command in its arguments, for example a
// toolchain wrapper: `x27.sh swift test`, `zsh run.sh cargo test`.
const SCRIPT = /\.(sh|bash|zsh)$/;

/** The command that a wrapper script in front of `argv` runs, or undefined. */
function wrapped(argv) {
  if (/^(ba|z)?sh$/.test(argv[0]) && SCRIPT.test(argv[1] ?? ""))
    return argv.length > 2 ? argv.slice(2) : undefined;
  if (SCRIPT.test(argv[0]) && argv.length > 1) return argv.slice(1);
  return undefined;
}

// Package manager flags that select a workspace or a directory,
// with the number of values that each flag takes.
// Without these flags, the command runs the same script:
// `pnpm -r test` and `npm --prefix app test` run `test`.
const WORKSPACE_FLAGS = {
  npm: {
    "--prefix": 1,
    "-w": 1,
    "--workspace": 1,
    "--workspaces": 0,
    "-ws": 0,
    "--include-workspace-root": 0,
    "--if-present": 0,
  },
  pnpm: {
    "-r": 0,
    "--recursive": 0,
    "--filter": 1,
    "-F": 1,
    "-C": 1,
    "--dir": 1,
    "-w": 0,
    "--workspace-root": 0,
    "--parallel": 0,
    "--stream": 0,
    "--if-present": 0,
  },
  yarn: { "--cwd": 1 },
  bun: { "--filter": 1, "-F": 1, "--cwd": 1 },
};

/**
 * `argv` without the workspace and toolchain selection in front of the
 * script: `cargo +nightly test` is `cargo test`, and
 * `yarn workspace web test` is `yarn test`.
 */
function workspaceArgv(argv) {
  const [name, ...rest] = argv;
  if (name === "cargo" && rest[0]?.startsWith("+"))
    return [name, ...rest.slice(1)];
  if (name === "yarn" && rest[0] === "workspace" && rest.length > 2)
    return [name, ...rest.slice(2)];
  if (name === "yarn" && rest[0] === "workspaces" && rest[1] === "foreach") {
    const run = rest.indexOf("run", 2);
    return run === -1 ? argv : [name, ...rest.slice(run)];
  }
  const flags = WORKSPACE_FLAGS[name];
  if (!flags) return argv;
  const out = [name];
  let i = 0;
  // Only flags before the script name: later flags go to the script.
  while (i < rest.length) {
    const word = rest[i];
    const flag = word.split("=")[0];
    if (Object.hasOwn(flags, flag))
      i += 1 + (word.includes("=") ? 0 : flags[flag]);
    else if (word === "run") out.push(rest[i++]);
    else break;
  }
  return [...out, ...rest.slice(i)];
}

// Flags that make a check command show help, a version, or a list,
// skip the run, or change files.
// A command with one of them checks nothing.
const NO_CHECK_FLAGS = new Set([
  "-h",
  "--help",
  "-help",
  "--version",
  "-version",
  "--list",
  "-list",
  "--list-tests",
  "--listTests",
  "--collect-only",
  "--co",
  "--show-only",
  "--no-run",
  "--fix",
  "--fix-only",
  "--write",
  "--apply",
  "--apply-unsafe",
  "--autocorrect",
]);

/** @param {string} word */
function noCheckFlag(word) {
  const flag = word.split("=")[0];
  return NO_CHECK_FLAGS.has(flag) || flag.startsWith("--help-");
}

// Flags with the same effect that only one tool reads in this way.
// For a formatter, `--dry-run` is the check, so only these tools have it.
const MAKE_DRY = ["-n", "--just-print", "--recon", "--dry-run"];
const GRADLE_DRY = ["-m", "--dry-run"];
const NO_CHECK_TOOL_FLAGS = new Map([
  ["make", MAKE_DRY],
  ["gmake", MAKE_DRY],
  [
    "just",
    [
      "-n",
      "--dry-run",
      "-l",
      "--summary",
      "-s",
      "--show",
      "--evaluate",
      "--dump",
      "--fmt",
      "--edit",
      "--init",
      "--choose",
      "--variables",
      "--groups",
    ],
  ],
  ["task", ["-n", "--dry", "-l", "-a", "--list-all", "--summary", "--init"]],
  ["mage", ["-l", "-init"]],
  [
    "rake",
    [
      "-n",
      "--dry-run",
      "-T",
      "--tasks",
      "-D",
      "--describe",
      "-P",
      "--prereqs",
      "-W",
      "--where",
    ],
  ],
  ["gradle", GRADLE_DRY],
  ["gradlew", GRADLE_DRY],
  ["turbo", ["--dry", "--dry-run"]],
  ["mocha", ["--dry-run"]],
  ["rspec", ["--dry-run"]],
  ["ctest", ["-N"]],
  ["ktlint", ["-F", "--format"]],
  ["rubocop", ["-a", "-A", "--autocorrect-all", "-x", "--fix-layout"]],
  [
    "xcodebuild",
    [
      "-showBuildSettings",
      "-showsdks",
      "-showdestinations",
      "-showTestPlans",
      "-showComponent",
    ],
  ],
]);

// Subcommands that list tests.
const NO_CHECK_SUBCOMMANDS = [
  ["vitest", "list"],
  ["swift", "test", "list"],
  ["cargo", "nextest", "list"],
  // A dev server and a watcher do not end, so they do not check.
  ["webpack", "serve"],
  ["webpack", "watch"],
];

/** True when the tool at the start of `argv` runs in a mode that checks nothing. */
function checksNothingHere(argv) {
  const flags = NO_CHECK_TOOL_FLAGS.get(argv[0]);
  if (flags?.some((f) => argv.includes(f))) return true;
  return NO_CHECK_SUBCOMMANDS.some((words) => leads(argv, words));
}

/** True when `command` is the same as a command that the project names, with more words after it. */
function startsWith(argv, command) {
  let first;
  try {
    first = parse(command).commands[0];
  } catch {
    return false;
  }
  const want = first ? workspaceArgv([first.name, ...first.args]) : [];
  return want.length > 0 && want.every((w, i) => argv[i] === w);
}

/**
 * The first simple command in `command` that is a check, without wrappers,
 * and the kind of the checks in `command`, or undefined.
 * The kind is `run` when one of the checks runs the code, and `static` when
 * all of them only read it.
 * Hook messages quote the command,
 * so a heredoc or a long pipeline around the check does not show.
 * A run of a command in `project`, the commands that the project names for its tests, counts first.
 */
export function checkInfo(command, project = []) {
  let found;
  let kind;
  try {
    for (const cmd of parse(command).commands) {
      const joined = [cmd.name, ...cmd.args].join(" ");
      const argv = workspaceArgv([cmd.name, ...cmd.args]);
      let here;
      if (project.some((p) => startsWith(argv, p))) {
        if (argv.some(noCheckFlag)) continue;
        here = "run";
      } else {
        // Only the flags of the command itself count: in
        // `docker run -h box img pytest`, `-h` belongs to `docker`.
        const kinds = forms(argv).map((a) => {
          const own = workspaceArgv(a);
          return own.some(noCheckFlag) ? undefined : kindOf(own);
        });
        here = kinds.includes("run")
          ? "run"
          : kinds.includes("static")
            ? "static"
            : undefined;
      }
      if (!here) continue;
      found ??= joined;
      kind = kind === "run" || here === "run" ? "run" : "static";
    }
  } catch {
    // An unparsable command is not a check.
    return undefined;
  }
  return found === undefined ? undefined : { command: found, kind };
}

/** The first simple command in `command` that is a check, or undefined. */
export function checkCommand(command, project = []) {
  return checkInfo(command, project)?.command;
}
