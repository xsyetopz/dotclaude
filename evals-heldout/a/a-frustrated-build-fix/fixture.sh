#!/usr/bin/env bash
set -euo pipefail
mkdir -p templates content scripts
git init -q
commit() { git -c user.name=dev -c user.email=dev@example.com commit -qm "$1"; }
cat > build.js <<'EOF'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const TEMPLATE = path.join(ROOT, 'templates', 'layout.html');
const CONTENT_DIR = path.join(ROOT, 'content');
const OUT_DIR = path.join(ROOT, 'dist');

function readPage(file) {
  const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
  const [first, ...rest] = raw.split('\n');
  const paragraphs = rest.join('\n').trim().split(/\n\n+/);
  return {
    slug: path.basename(file, '.txt'),
    title: first.replace(/^#\s*/, ''),
    body: paragraphs.map((p) => `<p>${p}</p>`).join('\n'),
  };
}

function render(template, page) {
  return template.replace('{{title}}', page.title).replace('{{body}}', page.body);
}

const template = fs.readFileSync(TEMPLATE, 'utf8');
fs.mkdirSync(OUT_DIR, { recursive: true });
const pages = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.txt')).sort().map(readPage);
const hash = crypto.createHash('sha256');
for (const page of pages) {
  const html = render(template, page);
  fs.writeFileSync(path.join(OUT_DIR, `${page.slug}.html`), html);
  hash.update(html);
}
console.log(`built ${pages.length} pages into dist/ (${hash.digest('hex').slice(0, 10)})`);
EOF
cat > templates/layout.html <<'EOF'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>{{title}} | Fieldnotes</title></head>
<body>
<main>
<h1>{{title}}</h1>
{{body}}
</main>
</body>
</html>
EOF
printf '# About\nFieldnotes is a small blog about birding in the Tatras.\n\nPosts go up most Sundays.\n' > content/about.txt
printf '# Wallcreeper\nFinally saw one above the Kościelisko valley.\n\nRed wings, very fast.\n' > content/wallcreeper.txt
printf '# Gear\nBinoculars: 8x42.\n\nBoots: whatever survives the scree.\n' > content/gear.txt
echo "dist/" > .gitignore
git add -A
commit "static site build"
git mv templates/layout.html templates/base.html
cat > scripts/preview.js <<'EOF'
'use strict';
// Serves the base template with placeholder text for quick CSS checks.
const http = require('http');
const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'base.html'), 'utf8');
const html = template.replace(/\{\{title\}\}/g, 'Preview').replace('{{body}}', '<p>Lorem ipsum.</p>');

http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
}).listen(Number(process.env.PORT || 4000));
EOF
git add -A
commit "rename layout template to base.html, add preview server"
