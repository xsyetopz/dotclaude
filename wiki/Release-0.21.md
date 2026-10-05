# Release 0.21

Released 2026-10-05.
Adds a redaction-marker edit guard and the `sembr` line-break hook, and removes the Stop verify gate.
A compaction with a handoff note now stops, and the user continues after `/clear`.

## Added

- The edit guard asks before an edit that writes a `[REDACTED:` marker into a file.
  The secret redaction puts this marker in a tool output in place of a value, so an edit from that output can replace the real value.
  In one session, Betterleaks found the RFC 6455 sample nonce in a test file, and the output showed the marker 10 times.
- The line-break hook runs [sembr](https://github.com/admk/sembr) on the prose that Claude writes.
  - Before a `git commit`, `gh pr`, or `gh issue` command runs, it rewraps the message with semantic line breaks.
  - After a `Write` or `Edit` of Markdown or code comments that break lines at a column, the result gets the `sembr` text.
  - The hook never rewrites a file, because a changed file makes the next `old_string` fail to match.
  - The line-break check was removed in 0.20.0, and after that the rule alone did not stop Claude from breaking prose at a column.
  - The `sembr` option turns the hook off, and the hook does nothing without `sembr` on `PATH`.
  - `/dotclaude:setup` offers to install it.

## Changed

- After an automatic compaction with a handoff note, Claude stops.
  It tells the user where the note is, and it gives a prompt to send after `/clear`.
  On 2026-10-05, Claude wrote 21 handoff notes and continued in the compacted context after each one, so no note started a small context.
  The compacted conversation no longer gets the text of the note, because the fresh session reads the file.
  A manual `/compact` writes no note, because the user chose to continue in the same session.

## Removed

- The Stop verify gate is removed.
  It found a check only by a list of command names, so it sent Claude back after checks that are not in the list, such as `just markdown` or `bunx markdownlint-cli2`.
  The working rules still tell Claude to run a check and to name each skipped check.

## Fixed

- The Bash guard asks before a `git checkout` or `git restore` of named files, because the command discards their uncommitted changes and git cannot restore them.
  Before, it asked only for the path `.`.
  In one session, Claude ran `git checkout` on a file to undo one small edit, and the command also discarded the uncommitted tests of earlier sessions.
  A branch switch, such as `git checkout main` or `git checkout feature/login`, does not ask, because it keeps uncommitted changes.
- The CodeGraph augment adds a note only for a real definition.
  `codegraph callers` falls back to a text search for a name that is not a symbol, so words such as `token`, `delet`, and `REDACTED` got notes with unrelated callers.
  The hook now runs `codegraph query` first, and it continues only when the index has a function, method, class, or a similar definition with exactly that name.
  The note names the file and line of the definition.
  The new bound `CODEGRAPH_QUERY_LIMIT` sets the number of query results.
- The note for an index from an earlier CodeGraph version names `codegraph index`.
  `codegraph sync` does not clear this state, so the old note sent Claude to a command that does not help.

Previous: [Release 0.20](Release-0.20) · Next: [Current changelog](https://github.com/xsyetopz/dotclaude/blob/main/CHANGELOG.md)
