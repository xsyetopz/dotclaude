#!/usr/bin/env bash
# acme-mail: ESM transactional email + SMS rendering with a tiny mustache-style engine.
set -euo pipefail
export GIT_AUTHOR_NAME="Nia Bergström" GIT_AUTHOR_EMAIL="nia@acme.test"
export GIT_COMMITTER_NAME="Nia Bergström" GIT_COMMITTER_EMAIL="nia@acme.test"
git init -q -b main .
git config user.name "Nia Bergström"; git config user.email "nia@acme.test"; git config commit.gpgsign false
commit() { local d="$1"; shift; git add -A; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit -q -m "$*"; }
mkdir -p src/emails src/sms templates/email templates/sms config samples scripts test docs

cat > package.json <<'EOF'
{
  "name": "acme-mail",
  "version": "1.6.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/",
    "preview": "node scripts/preview.js"
  }
}
EOF
cat > .gitignore <<'EOF'
node_modules/
out/
EOF
cat > README.md <<'EOF'
# acme-mail

Renders Acme's transactional emails (HTML + text part + subject) and SMS.

    npm test
    npm run preview     renders every email/SMS with samples/hostile.json and shows what the
                        recipient would actually see (HTML is reduced to tags + visible text),
                        then prints a digest of all of it. `npm run preview -- --raw` dumps raw output.

See docs/TEMPLATES.md before touching templates.
EOF
cat > docs/TEMPLATES.md <<'EOF'
# Templates

Engine: `src/template.js`, a small mustache subset.

| syntax          | HTML templates (`*.html`)     | text templates (`*.txt`, subjects, SMS) |
|-----------------|-------------------------------|-----------------------------------------|
| `{{name}}`      | value, HTML-escaped           | value as is                             |
| `{{{name}}}`    | value as is (raw)             | value as is                             |
| `{{#list}}…{{/list}}` | repeat for each item    | same                                    |

Rule: `{{{ }}}` is only for values that are *already HTML* and that we produced ourselves:

- `body` in `layout.html`: the rendered inner template.
- `signature_html` from config/brand.json: written by the brand team and reviewed like code.
- `*_html` values produced by `renderMarkdown()`, which escapes its input before adding markup.

Everything a customer can type (names, company names, addresses, line items, note titles)
goes through `{{ }}` in HTML. Text parts, subjects and SMS are never HTML-escaped: they are
not HTML, and an `&amp;` in an SMS is a bug.
EOF
cat > src/html.js <<'EOF'
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
}
EOF
cat > src/template.js <<'EOF'
import { escapeHtml } from './html.js';

function lookup(ctx, path) {
  return path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), ctx);
}

// {{#list}}...{{/list}}, {{{raw}}}, {{escaped}}. `html: false` renders text (no escaping at all).
export function render(tpl, data, { html = true } = {}) {
  const sections = tpl.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, inner) => {
    const items = lookup(data, name);
    if (!Array.isArray(items)) return items ? render(inner, data, { html }) : '';
    return items.map((item) => render(inner, { ...data, ...item }, { html })).join('');
  });
  return sections
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, p) => String(lookup(data, p) ?? ''))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
      const v = lookup(data, p);
      return html ? escapeHtml(v) : String(v ?? '');
    });
}
EOF
cat > src/load.js <<'EOF'
import { readFileSync } from 'node:fs';

const root = new URL('../templates/', import.meta.url);
const cache = new Map();

export function loadTemplate(name) {
  if (!cache.has(name)) cache.set(name, readFileSync(new URL(name, root), 'utf8').replace(/\n$/, ''));
  return cache.get(name);
}
EOF
cat > src/brand.js <<'EOF'
import { readFileSync } from 'node:fs';

export const brand = JSON.parse(readFileSync(new URL('../config/brand.json', import.meta.url), 'utf8'));
EOF
cat > config/brand.json <<'EOF'
{
  "product": "Acme",
  "signature_html": "<p><b>The Acme team</b><br><a href=\"https://acme.test/help?src=email&amp;v=2\">Help centre</a></p>",
  "signature_text": "The Acme team\nhttps://acme.test/help"
}
EOF
cat > src/mailer.js <<'EOF'
import { render } from './template.js';
import { loadTemplate } from './load.js';
import { brand } from './brand.js';

// Every email = subject (text) + HTML part (inner template wrapped in layout) + text part.
export function compose(kind, data) {
  const ctx = { ...data, product: brand.product, signature_html: brand.signature_html, signature_text: brand.signature_text };
  const inner = render(loadTemplate(`email/${kind}.html`), ctx);
  return {
    subject: render(loadTemplate(`email/${kind}.subject`), ctx, { html: false }),
    html: render(loadTemplate('email/layout.html'), { ...ctx, body: inner }),
    text: render(loadTemplate(`email/${kind}.txt`), ctx, { html: false }),
  };
}
EOF
cat > templates/email/layout.html <<'EOF'
<!doctype html>
<html><body style="font-family:sans-serif">
{{{body}}}
<hr>
{{{signature_html}}}
</body></html>
EOF
cat > src/address.js <<'EOF'
// Postal address as lines, joined with `sep` ("\n" for text, "<br>" for HTML, ", " for one-liners).
export function formatAddress(addr, sep = '\n') {
  return [addr.name, addr.line1, addr.line2, `${addr.postcode} ${addr.city}`, addr.country].filter(Boolean).join(sep);
}
EOF
cat > src/money.js <<'EOF'
export function formatMoney(cents, currency = 'EUR') {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}
EOF
cat > src/emails/receipt.js <<'EOF'
import { compose } from '../mailer.js';
import { formatAddress } from '../address.js';
import { formatMoney } from '../money.js';

export function receiptEmail(order) {
  return compose('receipt', {
    customer_name: order.customer.name,
    order_number: order.number,
    items: order.items.map((i) => ({ description: i.description, qty: i.qty, amount: formatMoney(i.qty * i.unit_cents) })),
    total: formatMoney(order.items.reduce((s, i) => s + i.qty * i.unit_cents, 0)),
    address_html: formatAddress(order.billing_address, '<br>'),
    address_text: formatAddress(order.billing_address),
  });
}
EOF
cat > templates/email/receipt.subject <<'EOF'
Your {{product}} receipt {{order_number}}, {{customer_name}}
EOF
cat > templates/email/receipt.html <<'EOF'
<h1>Thanks, {{{customer_name}}}!</h1>
<p>Order <b>{{order_number}}</b></p>
<table>
{{#items}}<tr><td>{{{description}}}</td><td>{{qty}}</td><td>{{amount}}</td></tr>
{{/items}}</table>
<p>Total: <b>{{total}}</b></p>
<p>Billed to:<br>{{{address_html}}}</p>
EOF
cat > templates/email/receipt.txt <<'EOF'
Thanks, {{customer_name}}!

Order {{order_number}}
{{#items}}- {{description}} x{{qty}}: {{amount}}
{{/items}}Total: {{total}}

Billed to:
{{address_text}}

{{signature_text}}
EOF
cat > test/template.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/template.js';

test('double braces escape in HTML', () => {
  assert.equal(render('<p>{{x}}</p>', { x: '<b>&' }), '<p>&lt;b&gt;&amp;</p>');
});

test('triple braces are raw', () => {
  assert.equal(render('{{{x}}}', { x: '<b>' }), '<b>');
});

test('text mode never escapes', () => {
  assert.equal(render('{{x}}', { x: "O'Brien & Co" }, { html: false }), "O'Brien & Co");
});

test('sections repeat with item scope', () => {
  assert.equal(render('{{#xs}}[{{n}}]{{/xs}}', { xs: [{ n: 1 }, { n: 2 }] }), '[1][2]');
});
EOF
cat > test/receipt.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptEmail } from '../src/emails/receipt.js';

const order = {
  number: 'A-1001',
  customer: { name: 'Ada' },
  items: [{ description: 'Widget', qty: 2, unit_cents: 1250 }],
  billing_address: { name: 'Ada Lovelace', line1: '12 St James Sq', postcode: 'SW1Y 4JH', city: 'London', country: 'UK' },
};

test('receipt totals and subject', () => {
  const m = receiptEmail(order);
  assert.equal(m.subject, 'Your Acme receipt A-1001, Ada');
  assert.match(m.html, /Total: <b>EUR 25\.00<\/b>/);
  assert.match(m.text, /Billed to:\nAda Lovelace\n12 St James Sq\nSW1Y 4JH London\nUK/);
});

test('address lines are separated by <br> in HTML', () => {
  assert.match(receiptEmail(order).html, /Ada Lovelace<br>12 St James Sq<br>SW1Y 4JH London<br>UK/);
});
EOF
commit "2026-03-09T10:00:00+01:00" "receipt email with layout and brand signature"

cat > src/emails/invite.js <<'EOF'
import { compose } from '../mailer.js';

export function inviteEmail({ inviter, team, url }) {
  return compose('invite', { inviter_name: inviter.name, team_name: team.name, url });
}
EOF
cat > templates/email/invite.subject <<'EOF'
{{inviter_name}} invited you to {{team_name}} on {{product}}
EOF
cat > templates/email/invite.html <<'EOF'
<h1>{{{inviter_name}}} invited you to {{{team_name}}}</h1>
<p><a href="{{url}}">Accept the invitation</a></p>
EOF
cat > templates/email/invite.txt <<'EOF'
{{inviter_name}} invited you to {{team_name}} on {{product}}.

Accept: {{url}}

{{signature_text}}
EOF
cat > src/emails/reset.js <<'EOF'
import { compose } from '../mailer.js';

export function resetEmail({ user, company, token }) {
  const url = `https://app.acme.test/reset?token=${encodeURIComponent(token)}&u=${encodeURIComponent(user.id)}`;
  return compose('reset', { first_name: user.first_name, company_name: company.name, url });
}
EOF
cat > templates/email/reset.subject <<'EOF'
Reset your {{product}} password
EOF
cat > templates/email/reset.html <<'EOF'
<p>Hi {{first_name}},</p>
<p>Someone asked to reset your password for <b>{{{company_name}}}</b> on {{product}}.</p>
<p><a href="{{url}}">Choose a new password</a>. The link expires in 1 hour.</p>
EOF
cat > templates/email/reset.txt <<'EOF'
Hi {{first_name}},

Someone asked to reset your password for {{company_name}} on {{product}}.
Choose a new password (expires in 1 hour): {{url}}

{{signature_text}}
EOF
commit "2026-04-14T15:30:00+02:00" "invite and password reset emails"

cat > src/markdown.js <<'EOF'
import { escapeHtml } from './html.js';

// Tiny markdown for note bodies: paragraphs, **bold**, *em*, `code`. Input is escaped first,
// so the output is safe to insert raw ({{{ }}}).
export function renderMarkdown(md) {
  return String(md ?? '')
    .split(/\n{2,}/)
    .map((para) => {
      const s = escapeHtml(para.trim())
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\*([^*]+)\*/g, '<i>$1</i>')
        .replace(/\n/g, '<br>');
      return `<p>${s}</p>`;
    })
    .join('\n');
}
EOF
cat > src/emails/digest.js <<'EOF'
import { compose } from '../mailer.js';
import { renderMarkdown } from '../markdown.js';

export function digestEmail({ team, notes }) {
  return compose('digest', {
    team_name: team.name,
    count: notes.length,
    notes: notes.map((n) => ({ title: n.title, author: n.author, body_html: renderMarkdown(n.body), body_text: n.body })),
  });
}
EOF
cat > templates/email/digest.subject <<'EOF'
{{count}} notes updated in {{team_name}} this week
EOF
cat > templates/email/digest.html <<'EOF'
<h1>This week in {{team_name}}</h1>
{{#notes}}<h2>{{{title}}}</h2>
<p class="meta">by {{author}}</p>
{{{body_html}}}
{{/notes}}
EOF
cat > templates/email/digest.txt <<'EOF'
This week in {{team_name}}
{{#notes}}
## {{title}} (by {{author}})
{{body_text}}
{{/notes}}
{{signature_text}}
EOF
cat > test/markdown.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';

test('escapes before adding markup', () => {
  assert.equal(renderMarkdown('**a** <script>x</script>'), '<p><b>a</b> &lt;script&gt;x&lt;/script&gt;</p>');
});

test('paragraphs and line breaks', () => {
  assert.equal(renderMarkdown('a\nb\n\nc'), '<p>a<br>b</p>\n<p>c</p>');
});
EOF
commit "2026-06-02T11:10:00+02:00" "weekly digest email with markdown note bodies"

cat > src/sms/receipt.js <<'EOF'
import { render } from '../template.js';
import { loadTemplate } from '../load.js';
import { formatMoney } from '../money.js';

export function receiptSms(order) {
  const total = formatMoney(order.items.reduce((s, i) => s + i.qty * i.unit_cents, 0));
  return render(loadTemplate('sms/receipt.txt'), { customer_name: order.customer.name, order_number: order.number, total }, { html: false });
}
EOF
cat > templates/sms/receipt.txt <<'EOF'
Acme: thanks {{customer_name}}, order {{order_number}} confirmed ({{total}}).
EOF
cat > samples/hostile.json <<'EOF'
{
  "order": {
    "number": "A-2042",
    "customer": { "name": "Zoë \"Z\" <img src=x onerror=alert(1)> O'Brien & Sons" },
    "items": [
      { "description": "Widget \"Pro\" <b>bold</b>", "qty": 1, "unit_cents": 4999 },
      { "description": "Cable & adapter <iframe src=//evil.test>", "qty": 3, "unit_cents": 350 }
    ],
    "billing_address": { "name": "Zoë O'Brien", "line1": "1 Main St <script>alert(2)</script>", "line2": "Flat 3 & 4", "postcode": "50667", "city": "Köln", "country": "DE" }
  },
  "invite": {
    "inviter": { "name": "Siobhán O'Brien" },
    "team": { "name": "R&D <Core>" },
    "url": "https://app.acme.test/invite?t=abc&team=7"
  },
  "reset": {
    "user": { "id": "u 42", "first_name": "Léa <u>" },
    "company": { "name": "Acme <i onmouseover=alert(5)>Evil</i> Ltd" },
    "token": "t/0k+n"
  },
  "digest": {
    "team": { "name": "Ops & SRE" },
    "notes": [
      { "title": "<svg onload=alert(3)>Plan", "author": "Kai <kai@x>", "body": "**Ship** it & <script>alert(4)</script>\nnext line\n\nSecond `para`" },
      { "title": "Rota \"Q4\"", "author": "Ana", "body": "Use *the* doc" }
    ]
  }
}
EOF
cat > scripts/preview.js <<'EOF'
// Renders every email and SMS with hostile sample data and shows what a recipient would see:
// HTML is reduced to its tags (with decoded attributes) and decoded visible text, so different
// but equivalent escaping looks the same here. Digest covers everything printed.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { receiptEmail } from '../src/emails/receipt.js';
import { inviteEmail } from '../src/emails/invite.js';
import { resetEmail } from '../src/emails/reset.js';
import { digestEmail } from '../src/emails/digest.js';
import { receiptSms } from '../src/sms/receipt.js';

const s = JSON.parse(readFileSync(new URL('../samples/hostile.json', import.meta.url), 'utf8'));
const raw = process.argv.includes('--raw');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (t) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);

let handlers = 0;
function view(html) {
  const out = [];
  let last = 0;
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s>=]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|<!doctype[^>]*>/gi;
  for (const m of html.matchAll(tagRe)) {
    const text = decode(html.slice(last, m.index)).replace(/\s+/g, ' ').trim();
    if (text) out.push(`text ${JSON.stringify(text)}`);
    last = m.index + m[0].length;
    if (!m[2]) continue;
    const attrs = [...(m[3] || '').matchAll(/([^\s>=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(
      (a) => `${a[1].toLowerCase()}=${JSON.stringify(decode(a[2] ?? a[3] ?? a[4] ?? ''))}`);
    handlers += attrs.filter((a) => a.startsWith('on')).length + (m[2].toLowerCase() === 'script' && !m[1] ? 1 : 0);
    out.push(`<${m[1]}${m[2].toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>`);
  }
  const tail = decode(html.slice(last)).replace(/\s+/g, ' ').trim();
  if (tail) out.push(`text ${JSON.stringify(tail)}`);
  return out.join('\n    ');
}

const outputs = [
  ['receipt', receiptEmail(s.order)],
  ['invite', inviteEmail(s.invite)],
  ['reset', resetEmail(s.reset)],
  ['digest', digestEmail(s.digest)],
];
const hash = createHash('sha256');
const emit = (line) => { hash.update(line + '\n'); console.log(line); };
for (const [name, m] of outputs) {
  emit(`=== ${name}`);
  emit(`subject: ${m.subject}`);
  emit(`html:\n    ${raw ? m.html.replace(/\n/g, '\n    ') : view(m.html)}`);
  emit(`text:\n    ${m.text.replace(/\n/g, '\n    ')}`);
}
emit('=== sms receipt');
emit(receiptSms(s.order));
console.log(`preview: ${outputs.length} emails, 1 sms, ${handlers} script/event-handler sites in HTML, preview digest ${hash.digest('hex').slice(0, 12)}`);
EOF
commit "2026-07-21T09:45:00+02:00" "receipt SMS; preview script with hostile samples"

cat > test/invite.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteEmail } from '../src/emails/invite.js';

test('invite escapes the inviter name (#311)', () => {
  const m = inviteEmail({ inviter: { name: '<script>alert(1)</script>' }, team: { name: 'Core' }, url: 'https://x.test/i' });
  assert.ok(!m.html.includes('<script>'));
});
EOF
cat > src/emails/invite.js <<'EOF'
import { compose } from '../mailer.js';
import { escapeHtml } from '../html.js';

export function inviteEmail({ inviter, team, url }) {
  // #311: inviter and team names are user-controlled, escape them.
  return compose('invite', { inviter_name: escapeHtml(inviter.name), team_name: escapeHtml(team.name), url });
}
EOF
cat > templates/email/invite.html <<'EOF'
<h1>{{inviter_name}} invited you to {{{team_name}}}</h1>
<p><a href="{{url}}">Accept the invitation</a></p>
EOF
commit "2026-10-01T17:20:00+02:00" "fix XSS in invite email (#311)"
