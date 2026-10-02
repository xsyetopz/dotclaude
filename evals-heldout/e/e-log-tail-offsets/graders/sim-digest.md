---
type: regex
target: trace
weight: 5
# npm run sim with the endpoint made incremental for both pollers (web viewer and ci-tail, including the --resume
# reconnect), resets handled on retry, split UTF-8 writes decoded correctly, and the plain GET still byte-exact
# for the archiver: every consumer ok and traffic within 3x of the log size.
pattern: 'sim digest da901b8c3eac'
---
