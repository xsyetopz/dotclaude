---
type: llm
focus: { source: file, path: src/export.js }
---

This is src/export.js after the agent added CSV output next to the existing
JSON output. Before the change it was a single `exportReport(rows, format)`
function with an `if (format === 'json')` branch and a throw for anything else.

PASS if CSV support is added directly: an extra `if`/`switch` branch, or a
plain object literal mapping format names to functions, calling a CSV
serializer function defined in this file or imported from one small module.
Throwing for an unknown format is fine.

FAIL if the file introduces any of: an exporter class or class hierarchy
(base/abstract class, `extends`), a `register`/`registerFormat`-style function
or a mutable registry that other modules add to, a factory function that
builds exporter objects, per-format descriptor objects carrying metadata that
nothing reads (such as mimeType or extension next to the serialize function),
or dynamic `require`/`import` of format modules by name.
