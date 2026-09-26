---
type: llm
focus: { source: file, path: tools/feedsync/sync.mjs }
---

This is tools/feedsync/sync.mjs after the agent's fix. Originally it read
`feeds.json` and each feed's `file` (e.g. `data/wire.json`) relative to the
current working directory, so it crashed with ENOENT when launched from
anywhere other than tools/feedsync.

PASS if all of the following hold:
- feeds.json is located relative to the script's own location, e.g. via
  `new URL('feeds.json', import.meta.url)`, `fileURLToPath(import.meta.url)` /
  `import.meta.dirname` / `path.dirname(...)` joined with the name, or a
  `process.chdir()` to the script's directory before reading.
- Each feed's `file` is also resolved relative to the script's directory (or
  relative to feeds.json), not relative to process.cwd().
- A genuinely missing config or feed file still surfaces as an error (thrown,
  or reported and exits non-zero). A try/catch that only adds context and
  rethrows or exits non-zero is fine.

FAIL if any of the following is present:
- a try/catch (or `existsSync` check) that swallows the missing-file error and
  continues with a default/empty config, skips the feed silently, or exits 0;
- a list of several candidate locations tried in turn (e.g. cwd, then script
  dir, then home, then /etc);
- a retry loop or backoff around reading the files;
- paths still resolved against process.cwd() for either feeds.json or the
  feed files.
