// `checkCommand` finds the check inside a command, so the stop and task
// gates know that a test, build, or lint ran.

import { expect, test } from "bun:test";
import {
  CHECK,
  checkCommand,
  checkInfo,
  STATIC_TOOLS,
  TOOLS,
} from "../../hooks/lib/_check-command.mjs";

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
  ["uv run --with rich pytest -q", "pytest -q"],
  ["uv tool run --from ruff ruff check .", "ruff check ."],
  ["hatch run pytest", "hatch run pytest"],
  // Workspace and toolchain forms run the same script.
  ["pnpm -r test", "pnpm -r test"],
  ["pnpm --filter web test", "pnpm --filter web test"],
  ["pnpm -C app run lint", "pnpm -C app run lint"],
  ["npm --prefix app run build", "npm --prefix app run build"],
  ["npm -w app test", "npm -w app test"],
  ["bun run --filter=web test", "bun run --filter=web test"],
  ["yarn workspace web test", "yarn workspace web test"],
  [
    "yarn workspaces foreach -A run test",
    "yarn workspaces foreach -A run test",
  ],
  ["cargo +nightly test", "cargo +nightly test"],
  ["deno task test:unit", "deno task test:unit"],
  ["make test fmt", "make test fmt"],
  ["bun test fix", "bun test fix"],
  ["ruff format --check", "ruff format --check"],
  // Monorepo and other task runners classify the task name by its parts.
  ["turbo run test", "turbo run test"],
  ["turbo run lint build --filter=web", "turbo run lint build --filter=web"],
  ["turbo typecheck", "turbo typecheck"],
  ["nx run-many -t test lint", "nx run-many -t test lint"],
  ["nx run-many --target=build", "nx run-many --target=build"],
  ["nx affected -t test,e2e", "nx affected -t test,e2e"],
  ["nx run web:test:ci", "nx run web:test:ci"],
  ["nx test web", "nx test web"],
  ["nx format:check", "nx format:check"],
  ["lerna run test --scope web", "lerna run test --scope web"],
  ["rush build", "rush build"],
  ["rushx test", "rushx test"],
  ["moon run web:typecheck", "moon run web:typecheck"],
  ["moon ci", "moon ci"],
  ["mise run test", "mise run test"],
  ["task lint", "task lint"],
  ["poe test", "poe test"],
  ["pixi run test", "pixi run test"],
  ["hatch run test:cov", "hatch run test:cov"],
  ["invoke test", "invoke test"],
  ["gulp lint", "gulp lint"],
  ["rake spec", "rake spec"],
  ["rake", "rake"],
  ["composer test", "composer test"],
  ["composer run-script lint", "composer run-script lint"],
  ["cargo make ci", "cargo make ci"],
  ["cargo xtask lint", "cargo xtask lint"],
  ["sbt test", "sbt test"],
  ['sbt "testOnly a.B"', "sbt testOnly a.B"],
  ["mill app.test", "mill app.test"],
  ["lein test", "lein test"],
  ["mvn -pl core install", "mvn -pl core install"],
  ["./gradlew assembleDebug", "gradlew assembleDebug"],
  ["npm run format:check", "npm run format:check"],
  ["npm it", "npm it"],
  ["pnpm typecheck", "pnpm typecheck"],
  ["xcodebuild -scheme App clean build", "xcodebuild -scheme App clean build"],
  // Launchers run the tool after their own words and flags.
  ["bundle exec rspec spec/a_spec.rb", "bundle exec rspec spec/a_spec.rb"],
  ["rustup run stable cargo test", "rustup run stable cargo test"],
  ["npx -p typescript tsc --noEmit", "npx -p typescript tsc --noEmit"],
  ["pnpm exec vitest run", "pnpm exec vitest run"],
  ["pnpm dlx knip", "pnpm dlx knip"],
  ["yarn dlx prettier --check .", "yarn dlx prettier --check ."],
  ["bun x tsc", "bun x tsc"],
  ["npm exec -- eslint .", "npm exec -- eslint ."],
  ["conda run -n env pytest", "conda run -n env pytest"],
  ["mise exec node@20 -- npm test", "mise exec node@20 -- npm test"],
  ["asdf exec go test ./...", "asdf exec go test ./..."],
  ["nix develop -c cargo test", "nix develop -c cargo test"],
  ["direnv exec . pytest", "direnv exec . pytest"],
  ["devbox run pytest", "devbox run pytest"],
  ["arch -arm64 swift build", "arch -arm64 swift build"],
  ["dotnet tool run csharpier check .", "dotnet tool run csharpier check ."],
  ["python -m mypy src", "python -m mypy src"],
  ["python3 -W error -m pytest", "python3 -W error -m pytest"],
  ["php artisan test", "php artisan test"],
  ["python manage.py test", "python manage.py test"],
  ["node node_modules/.bin/jest", "node node_modules/.bin/jest"],
  ["php vendor/bin/phpstan analyse", "php vendor/bin/phpstan analyse"],
  [
    "docker run --rm -v x:/app img swift test",
    "docker run --rm -v x:/app img swift test",
  ],
  ["docker compose run app npm test", "docker compose run app npm test"],
  ["c8 -r lcov npm test", "c8 -r lcov npm test"],
  ["bash tests/run.sh", "bash tests/run.sh"],
  // Tools from each ecosystem.
  ["tsc -p .", "tsc -p ."],
  ["vue-tsc --noEmit", "vue-tsc --noEmit"],
  ["astro check", "astro check"],
  ["prettier --check .", "prettier --check ."],
  ["playwright test", "playwright test"],
  ["ng test", "ng test"],
  ["next build", "next build"],
  ["black --check .", "black --check ."],
  ["isort --check-only .", "isort --check-only ."],
  ["bandit -r src", "bandit -r src"],
  ["pre-commit run --all-files", "pre-commit run --all-files"],
  ["cargo nextest run", "cargo nextest run"],
  ["cargo deny check", "cargo deny check"],
  ["cargo fmt -- --check", "cargo fmt -- --check"],
  ["cargo --locked t", "cargo --locked t"],
  ["go -C app test ./...", "go -C app test ./..."],
  ["gofmt -l .", "gofmt -l ."],
  ["govulncheck ./...", "govulncheck ./..."],
  ["dotnet format --verify-no-changes", "dotnet format --verify-no-changes"],
  ["rubocop", "rubocop"],
  ["php-cs-fixer fix --dry-run", "php-cs-fixer fix --dry-run"],
  ["mix format --check-formatted", "mix format --check-formatted"],
  ["clang-format --dry-run a.c", "clang-format --dry-run a.c"],
  ["terraform fmt -check", "terraform fmt -check"],
  ["shfmt -d .", "shfmt -d ."],
  ["swiftc -typecheck a.swift", "swiftc -typecheck a.swift"],
  ["plutil -lint a.plist", "plutil -lint a.plist"],
  ["semgrep scan", "semgrep scan"],
  ["periphery scan", "periphery scan"],
  ["skills-ref validate x", "skills-ref validate x"],
  ["./scripts/ci/validate.sh", "validate.sh"],
  [
    "./gradlew :core:format:jvmTest --tests X",
    "gradlew :core:format:jvmTest --tests X",
  ],
  ["mvn spotless:check", "mvn spotless:check"],
  [
    "bunx @biomejs/biome@2.5.13 ci hooks",
    "bunx @biomejs/biome@2.5.13 ci hooks",
  ],
];

const NEW_CHECKS = [
  "docker run -h box img pytest",
  "docker run -v a:b img pytest tests",
  "lake build",
  "coqc theory.v",
  "verilator --lint-only top.v",
  "iverilog -o sim tb.v",
  "yosys -p synth top.v",
  "sby -f proof.sby",
  "pio test -e native",
  "pio run -e esp32",
  "idf.py build",
  "west build -b nrf52840dk_nrf52840",
  "dbt test --select orders",
  "dbt build",
  "sqlfluff lint models/",
  "jupyter nbconvert --execute --to notebook a.ipynb",
  "pytest --nbmake notebooks/",
  "godot --headless --script tests/run.gd",
  "godot --headless -s tests/run.gd",
  "godot --headless --check-only --script a.gd",
];

for (const command of NEW_CHECKS)
  test(`check: ${command}`, () => expect(checkCommand(command)).toBe(command));

const NOT_CHECKS = [
  "docker run img pytest --help",
  "npx jest --listTests",
  "webpack serve",
  "webpack watch",
  "npx webpack serve",
  "pio device list",
  "dbt docs serve",
  "dbt run-operation x",
  "jupyter nbconvert --to html a.ipynb",
  "sqlfluff fix models/",
  "godot --headless",
  "godot --script a.gd",
  "godot --path game",

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
  // Help, version, and list runs, runs that skip the tests, and fixes.
  "pytest --help",
  "scala-cli compile --help-full",
  "tsc --version",
  "pytest --collect-only -q",
  "npx jest --listTests",
  "npx vitest list",
  "go test -list .",
  "cargo test -- --list",
  "cargo test --no-run",
  "xcrun swift test list",
  "ctest -N",
  "make -n test",
  "eslint --fix .",
  "ruff check --fix",
  "ruff format",
  "biome check --write .",
  "cargo clippy --fix",
  "ktlint -F",
  "npm run lint:fix",
  "npm test -- --help",
  // Installs, servers, fix tasks, and runs that only list or plan.
  "npm ci",
  "pnpm ci",
  "turbo run dev",
  "turbo run lint:fix",
  "turbo run test --dry-run",
  "nx run web:serve",
  "nx format:write",
  "lerna run clean",
  "moon run web:dev",
  "gradle tasks",
  "./gradlew build -m",
  "./gradlew build --dry-run",
  "make --dry-run test",
  "mvn clean",
  "composer install",
  "pixi run dev",
  "rake -T",
  "just -l",
  "task --list",
  "rspec --dry-run",
  "xcodebuild -list",
  "xcodebuild -scheme AppTests -showBuildSettings",
  "cargo nextest list",
  "bundle exec rails server",
  "bundle exec rubocop -a",
  "npx create-react-app x",
  "python -m http.server",
  "rustup run stable cargo fmt",
  "docker run img ls",
  "black .",
  "isort .",
  "prettier --write .",
  "gofmt -w .",
  "shfmt -w .",
  "cargo fmt",
  "dotnet format",
  "terraform fmt",
  "rubocop -A",
  "php-cs-fixer fix",
  "clang-format -i a.c",
  "mix format",
  "zig fmt .",
  "swiftformat .",
  "echo constructor && ls",
  "mvn spotless:apply",
  "./gradlew :core:check:spotlessApply",
];

test("a help run of the project's own command is not a check", () => {
  expect(checkCommand("./run-tests.sh --help", PROJECT)).toBeUndefined();
  expect(checkCommand("pnpm -r test", ["pnpm test"])).toBe("pnpm -r test");
});

const PROJECT = ["uv run python manage.py test", "./run-tests.sh"];

test("a run of the project's own command counts first", () => {
  expect(checkCommand("uv run python manage.py test app -v 2", PROJECT)).toBe(
    "python manage.py test app -v 2",
  );
  expect(checkCommand("./run-tests.sh unit", PROJECT)).toBe(
    "run-tests.sh unit",
  );
  expect(checkCommand("python manage.py migrate", PROJECT)).toBeUndefined();
});

for (const [command, found] of CHECKS)
  test(`check: ${command}`, () => expect(checkCommand(command)).toBe(found));

for (const command of NOT_CHECKS)
  test(`not a check: ${command}`, () =>
    expect(checkCommand(command)).toBeUndefined());

// Each entry of `CHECK` has a string here, so that a change to one entry
// shows in a test.
const SAMPLES = [
  "node --test",
  "./scripts/check-localizations.sh",
  "bash tests/run.sh",
  "ojd check schemas",
];

test("each CHECK entry matches at least one sample", () => {
  const joined = SAMPLES.map((command) => checkCommand(command) ?? "");
  const unmatched = CHECK.filter((re) => !joined.some((j) => re.test(j)));
  expect(unmatched.map(String)).toEqual([]);
});

// Each tool form counts with its first flag, and a fix flag stops it.
for (const spec of TOOLS) {
  const command = spec.replace(/\|\S*/g, "");
  test(`tool form: ${command}`, () => {
    expect(checkCommand(command)).toBe(command);
    expect(checkCommand(`${command} --fix`)).toBeUndefined();
  });
}

// Kinds: `run` exercises the code, `static` only reads it.
const KINDS = [
  ["bun test", "run"],
  ["npm test", "run"],
  ["just test", "run"],
  ["just check", "run"],
  ["just verify", "run"],
  ["just", "run"],
  ["just lint", "static"],
  ["npm run lint", "static"],
  ["pnpm lint", "static"],
  ["just format-check", "static"],
  ["npm run build", "run"],
  ["tsc --noEmit", "run"],
  ["mypy src", "run"],
  ["pyright", "run"],
  ["cargo check", "run"],
  ["cargo clippy", "static"],
  ["eslint .", "static"],
  ["bunx eslint src", "static"],
  ["markdownlint-cli2 a.md", "static"],
  ["prettier --check .", "static"],
  ["ruff check .", "static"],
  ["biome ci .", "static"],
  ["shellcheck a.sh", "static"],
  ["./scripts/check-localizations.sh", "run"],
  ["./scripts/lint.sh", "static"],
  ["verilator --lint-only top.v", "static"],
  ["sqlfluff lint models/", "static"],
  ["godot --headless --check-only --script a.gd", "static"],
  ["godot --headless --script tests/run.gd", "run"],
  ["flutter analyze", "static"],
  ["dart analyze", "static"],
  ["go vet ./...", "static"],
  ["./gradlew detekt", "static"],
  ["./gradlew spotlessCheck", "static"],
  ["./gradlew ktlintCheck", "static"],
  ["./gradlew checkstyleMain", "static"],
  ["./gradlew check", "run"],
  ["./gradlew test detekt", "run"],
  ["pre-commit run --all-files", "static"],
  ["lake build", "run"],
  ["dbt test", "run"],
  ["pio run", "run"],
  ["jupyter nbconvert --execute a.ipynb", "run"],
  ["eslint . && bun test", "run"],
  ["bun test && eslint .", "run"],
  ["eslint . && prettier --check .", "static"],
];

for (const [command, kind] of KINDS)
  test(`kind of ${command} is ${kind}`, () =>
    expect(checkInfo(command)?.kind).toBe(kind));

test("a check info has the first check and no kind for a non-check", () => {
  expect(checkInfo("ls && eslint . && bun test")).toEqual({
    command: "eslint .",
    kind: "run",
  });
  expect(checkInfo("ls")).toBeUndefined();
  expect(checkInfo("./run-tests.sh unit", PROJECT)?.kind).toBe("run");
});

test("each static form is a tool form", () => {
  expect([...STATIC_TOOLS].filter((spec) => !TOOLS.includes(spec))).toEqual([]);
});

for (const spec of TOOLS) {
  const command = spec.replace(/\|\S*/g, "");
  test(`tool kind: ${command}`, () =>
    expect(checkInfo(command)?.kind).toBe(
      STATIC_TOOLS.has(spec) ? "static" : "run",
    ));
}
