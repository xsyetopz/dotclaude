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
    bun tools/sandbox.mjs "$@"

# Remove the sandbox config and project
sandbox-clean:
    bun tools/sandbox.mjs --clean

# Where your Claude Code usage went; extra arguments go to the report (--days N, --json)
usage *args:
    bun tools/usage-report.mjs "$@"

# Publish wiki/ to the GitHub wiki; the wiki repository exists only after its first page is made in the web UI
wiki:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    git clone --quiet https://github.com/xsyetopz/dotclaude.wiki.git "$tmp"
    rsync -a --delete --exclude .git wiki/ "$tmp/"
    git -C "$tmp" add -A
    if git -C "$tmp" diff --cached --quiet; then echo "The wiki is up to date."; exit 0; fi
    git -C "$tmp" commit --quiet -m "Sync wiki from dotclaude $(git rev-parse --short HEAD)"
    git -C "$tmp" push --quiet origin HEAD

# Bump the version (major, minor, patch, or X.Y.Z) in both manifests and the CHANGELOG; add --dry-run to preview
bump level *flags:
    bun tools/bump-version.mjs "$@"

# Tag each plugin under plugins/ at HEAD and push all tags in one atomic push; add --dry-run to preview
release *flags:
    #!/usr/bin/env bash
    set -euo pipefail
    tags=()
    for p in plugins/*/; do
        tags+=("$(claude plugin tag --dry-run "$p" | awk '/^Tag:/ {print $2}')")
    done
    printf 'Tags: %s\n' "${tags[*]}"
    if [[ "${1:-}" == --dry-run ]]; then exit 0; fi
    for p in plugins/*/; do claude plugin tag "$p"; done
    git push --atomic origin "${tags[@]/#/refs/tags/}"

# Run the investigator and web-researcher role cases with the agent at a model (opus or sonnet) and effort; this spends usage
eval-agent model effort runs="10":
    CLAUDE_CODE_SUBAGENT_MODEL=claude-{{ model }}-5-5 CLAUDE_CODE_EFFORT_LEVEL={{ effort }} claude plugin eval plugins/dotclaude --model opus --judge-model sonnet --runs {{ runs }} --ablation none --scaffold --allow-tools Bash WebFetch WebSearch --keep-temp --tag agent-role --json plugins/dotclaude/evals/results/agents-{{ model }}-{{ effort }}.json
    bun plugins/dotclaude/evals/oracle.mjs plugins/dotclaude/evals/results/agents-{{ model }}-{{ effort }}.json
    bun plugins/dotclaude/evals/report.mjs plugins/dotclaude/evals/results/agents-{{ model }}-{{ effort }}.json
