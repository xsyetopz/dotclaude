# AGENTS.md

A Claude Code plugin marketplace in ESM.
The scripts in `plugins/` run on Node.js 22.18 or later, so they use only `node:` modules.
The `um` command of `dotclaude-modder` runs on Bun, and the tests and `tools/` run on Bun.
The core plugin is in `plugins/dotclaude/`, next to the `dotclaude-browser`, `dotclaude-jev`, and `dotclaude-modder` plugins.
Each add-on plugin works without the core plugin, so it does not import from `plugins/dotclaude/`.
Only `plugins/` ships to users.
`tests/` has one folder for each plugin, and `tools/` holds the repository scripts.
`plugins/dotclaude/tests/` holds the hook lab, which `claude plugin test` runs against the hooks module.
Docs, design, and evidence: the [wiki](https://github.com/xsyetopz/dotclaude/wiki), with its source in `wiki/`.

## Commands (repository root)

- `just check` runs lint, tests, validation, and the hook lab.
  It must pass before done.
- `bun test tests/dotclaude/guard.test.mjs` runs one test file.
- `just lab` runs the hook lab: the tests of the hooks module with stubbed Claude Code events.
  Test each change to `hooks/mod.mjs` there before a live session.
- `bunx markdownlint-cli2 README.md` lints Markdown.
  Headings and code blocks have a 100-column bound.
- `just sandbox` runs Claude Code with this checkout in a separate config.
  Read `wiki/Sandbox.md` first.

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
- Change a usage bound only in `plugins/dotclaude/lib/budget.mjs`.
  Tests pin its copies in code and config, not in prose.
- Do not write runtime JavaScript (`plugins/`) for a feature that the latest Claude Code has.
  When Claude Code has a setting, a hook, or another extension point for a need, use it.
- In `plugins/dotclaude/`, `lib/` imports only itself.
  `hooks/`, `status-line/`, and the skill scripts import only `lib/` and their own folder.
- Tests give commands to the guards as strings.
  Never run a guarded command.
- Never patch the Claude Code CLI binary or its npm package, although it is minified JavaScript that you can read.
  A patch violates Anthropic's terms of service.
  Use only documented extension points.
  Reading the bundle for evidence is permitted.
- Add CHANGELOG entries under `[Unreleased]`.
  Change versions with `just bump`.
- Write public docs in `wiki/`, and run `just wiki` to publish them.
  `docs/README.md` only links to the wiki.
  `external/` holds local sources, and git ignores it.
