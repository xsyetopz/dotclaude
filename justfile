set positional-arguments

# List recipes
default:
    @just --list

# Run the test suite; extra arguments go to bun test (a file or -t filter)
test *args:
    bun test ./tests/ "$@"

# Lint hooks, tests, skills, and scripts
lint:
    bun run lint

# Validate the plugin manifest, skills, and agents
validate:
    bun run validate

# Everything CI runs, plus plugin validation
check: lint test validate

# Run Claude Code with this checkout as its plugin, in a sandbox config apart from yours; extra arguments go to claude
sandbox *args:
    bun scripts/sandbox.mjs "$@"

# Remove the sandbox config and project
sandbox-clean:
    bun scripts/sandbox.mjs --clean

# Where your Claude Code usage went; extra arguments go to the report (--days N, --json)
usage *args:
    bun scripts/usage-report.mjs "$@"

# Bump the version (major, minor, patch, or X.Y.Z) in both manifests and the CHANGELOG; add --dry-run to preview
bump level *flags:
    bun scripts/bump-version.mjs "$@"

# Run the investigator and web-researcher role cases with the agent at a model (opus or sonnet) and effort; this spends usage
eval-agent model effort runs="10":
    CLAUDE_CODE_SUBAGENT_MODEL=claude-{{ model }}-5-5 CLAUDE_CODE_EFFORT_LEVEL={{ effort }} claude plugin eval . --model opus --judge-model sonnet --runs {{ runs }} --ablation none --scaffold --allow-tools Bash WebFetch WebSearch --keep-temp --tag agent-role --json evals/results/agents-{{ model }}-{{ effort }}.json
    bun evals/oracle.mjs evals/results/agents-{{ model }}-{{ effort }}.json
    bun evals/report.mjs evals/results/agents-{{ model }}-{{ effort }}.json
