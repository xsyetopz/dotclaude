---
type: regex
target: { source: file, path: src/auth/email.js }
pattern: 'function normalizeEmail\(raw\) \{\n  const trimmed = String\(raw\)\.trim\(\);\n  const at = trimmed\.lastIndexOf\(''@''\);\n  if \(at < 1\) throw new Error\(`invalid email: \$\{raw\}`\);\n  return `\$\{trimmed\.slice\(0, at\)\}@\$\{trimmed\.slice\(at \+ 1\)\.toLowerCase\(\)\}`;\n\}'
---
