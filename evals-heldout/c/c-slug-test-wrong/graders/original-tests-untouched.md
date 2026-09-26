---
type: regex
target: { source: file, path: test/slugify.test.js }
pattern: 'slugify\(''  Many   spaces  ''\), ''many-spaces''\);[\s\S]*slugify\(''C\+\+ & Rust: 2026 edition''\), ''c-rust-2026-edition''\);'
---
