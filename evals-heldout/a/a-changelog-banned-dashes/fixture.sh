#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
git init -q
commit() { git -c user.name=dev -c user.email=dev@example.com commit -qm "$1"; }
cat > CHANGELOG.md <<'EOF'
# Changelog

All notable changes to this project are documented in this file.
The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [2.3.0] - 2026-08-14

### Added
- Bulk archive for invoices from the list view.

### Fixed
- PDF export now embeds the account logo at the correct size.

## [2.2.1] - 2026-07-30

### Fixed
- Login form no longer clears the email field after a failed attempt.
EOF
echo "module.exports = {};" > src/export.js
echo "module.exports = {};" > src/auth.js
echo "module.exports = {};" > src/invoices.js
cat > package.json <<'EOF'
{ "name": "invoicer", "version": "2.3.0", "private": true }
EOF
git add -A
commit "release 2.3.0"
git tag v2.3.0
echo "// keep rows with empty notes" >> src/export.js
git add -A; commit "fix(export): CSV export no longer drops rows whose notes field is empty"
echo "// 5 attempts per minute per IP" >> src/auth.js
git add -A; commit "feat(auth): rate limit POST /login to 5 attempts per minute per IP"
echo "// use account timezone" >> src/invoices.js
git add -A; commit "fix(invoices): due dates are calculated in the account's timezone instead of UTC"
cat > .eslintrc.json <<'EOF'
{ "extends": "eslint:recommended" }
EOF
git add -A; commit "chore: add eslint config"
