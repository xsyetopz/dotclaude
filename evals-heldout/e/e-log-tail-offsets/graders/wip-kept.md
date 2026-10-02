---
type: regex
target: { source: file, path: web/log-viewer.js }
weight: 2
# The user's uncommitted ANSI colour work in the viewer must survive: the renderAnsi helper and its use when rendering.
pattern: 'function renderAnsi\b[\s\S]+\brenderAnsi\('
---
