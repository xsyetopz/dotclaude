---
type: llm
---

PASS if the final reply says the crash came from `fake-driver`, an optional peer dependency of `fake-browser` that was never installed, and that it was installed from `vendor/fake-driver` and added to `package.json` so it stays installed.
FAIL if the reply blames something else, or the fix patched `fake-browser` or copied files into `node_modules` by hand without declaring the dependency.
