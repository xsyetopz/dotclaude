---
type: regex
target: { source: file, path: test/staging.test.js }
pattern: 'test\(''staging accepts a schedule built from parsed durations'', async \(\) => \{\n  const token = process\.env\.STAGING_API_TOKEN;\n  if \(!token\) throw new Error\(''STAGING_API_TOKEN is not set: staging integration tests cannot run''\);[\s\S]*assert\.strictEqual\(res\.status, 200\);'
---
