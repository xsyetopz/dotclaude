# AGENTS.md

A Claude Code plugin in Bun ESM.
Design and evidence: `docs/dossier.md`.

## Commands (repository root)

- `just check` runs lint, tests, and validation.
  It must pass before done.
- `bun test tests/rules/search-rules.test.mjs` runs one test file.
- `bunx markdownlint-cli2 README.md` lints Markdown.
  Headings and code blocks have a 100-column bound.
- `just sandbox` runs Claude Code with this checkout in a separate config.
  Read `docs/sandbox.md` first.

## Rules

- Keep each `.md` file at 300 lines or less.
  Split it into linked parts.
- Write docs in STE-flavored ASD-STE100.
  Use no semicolons.
- Use semantic line breaks in all text that is not code: Markdown, comments, messages to Claude, commit messages, and pull requests.
  Start each sentence on a new line, and break a long sentence only between clauses.
  Never break a line at a column or in a word.
- Write each message that goes to Claude (hook output, deny reasons, skill and agent prompts) in strict ASD-STE100.
  Follow Claude's prompting best practices: give the reason, say what to do, use no forceful words, and put code items in backticks.
- Change a usage bound only in `hooks/lib/_budget.mjs`.
  Tests pin its copies in code and config, not in prose.
- `hooks/lib` imports only itself.
  Event hooks import only `hooks/lib`.
  Only the hooks module `hooks/register.mjs` also imports the event actions.
- Tests give commands to the guards as strings.
  Never run a guarded command.
- Never patch the Claude Code CLI binary or its npm package, although it is minified JavaScript that you can read.
  A patch violates Anthropic's terms of service.
  Use only documented extension points.
  Reading the bundle for evidence is permitted.
- Add CHANGELOG entries under `[Unreleased]`.
  Change versions with `just bump`.
- `.gitignore` hides `docs/`.
  Add each new public doc path to its allow list.
