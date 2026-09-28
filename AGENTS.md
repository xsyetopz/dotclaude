# dotclaude

A Claude Code plugin in Bun ESM. Design and evidence: `docs/dossier.md`.

## Commands (repository root)

- `just check` runs lint, tests, and validation. It must pass before done.
- `bun test tests/rules/search-rules.test.mjs` runs one test file.
- `bunx markdownlint-cli2 README.md` lints Markdown at 80 columns.
- `just sandbox` runs Claude Code with this checkout in a separate config.
  Read `docs/sandbox.md` first.
- `just sandbox` runs Claude Code with this checkout in a separate config.
  Read `docs/sandbox.md` first.

## Rules

- Keep each `.md` file at 300 lines or less. Split it into linked parts.
- Write docs in STE-flavored ASD-STE100. Use no semicolons.
- Change a usage bound only in `hooks/lib/_budget.mjs`. Tests pin its copies.
- `hooks/lib` imports only itself. Event hooks import only `hooks/lib`.
- Tests give commands to the guards as strings. Never run a guarded command.
- Add CHANGELOG entries under `[Unreleased]`. Change versions with `just bump`.
- `.gitignore` hides `docs/`. Add each new public doc path to its allow list.
