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

# Bump the version (major, minor, patch, or X.Y.Z) in both manifests and the CHANGELOG; add --dry-run to preview
bump level *flags:
    bun scripts/bump-version.mjs "$@"
