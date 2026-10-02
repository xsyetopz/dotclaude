// A pure parser for the block-style YAML subset that dotclaude reads: the
// frontmatter of skill, agent, rule, and output-style files, and the `hosts.yml`
// of the GitHub CLI. It imports nothing, so it also runs in a hooks module that
// has no Node and no Bun. It gives the same value as `Bun.YAML.parse` for the
// subset, and throws an Error for input outside it (anchors, aliases, tags,
// complex keys, and more than one document).
//
// Known differences from Bun, which this parser keeps on purpose:
// - Anchors, aliases, tags, `?` keys, and more than one document throw here.
// - An empty key (`: x`) and a flow collection as a key throw here.
// - A top-level line that starts with a tab throws here.
// - A hex literal that overflows a double becomes a Number here.
// - The flow map `{:x}` is not read here.
// - CRLF inside a quoted block value is not kept as Bun keeps it.
// - A block header with a space and a chomp sign (`| -`) throws here.
// - Some odd lines after a block scalar (a tab and a comment, then a tab-only
//   line) are read here, and Bun throws.
// - A hostile input of 1 MB of dashes costs about 1 second.

const BLOCK_HEADER = /^([|>])(?:([1-9])([+-])?|([+-])([1-9])?)?$/;
const ESCAPES = {
  0: "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\u0085",
  _: "\u00a0",
  L: "\u2028",
  P: "\u2029",
};
const HEX_ESCAPES = { x: 2, u: 4, U: 8 };
// The deepest nesting of block and flow collections. A deeper input is an error,
// so that a hostile input cannot use much time or stack.
const MAX_DEPTH = 64;

const isSpace = (c) => c === " " || c === "\t";

/** Trim the YAML whitespace (space and tab) only. `trim` also cuts U+00A0. */
function trimStart(text) {
  let i = 0;
  while (i < text.length && isSpace(text[i])) i++;
  return text.slice(i);
}

/** Trim the end, but keep the first `keep` characters, as an escape asks. */
function trimEnd(text, keep = 0) {
  let end = text.length;
  while (end > keep && isSpace(text[end - 1])) end--;
  return text.slice(0, end);
}

const trim = (text) => trimStart(trimEnd(text));

/** The count of spaces that start a line. */
const indentOf = (line) => /^ */.exec(line)[0].length;

function fail(message) {
  throw new Error(`YAML Parse error: ${message}`);
}

function put(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Read a quoted scalar at `start`. Returns the string and the end index. */
function readQuoted(text, start) {
  const quote = text[start];
  let out = "";
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (quote === "'") {
      if (c !== "'") out += c;
      else if (text[i + 1] === "'") {
        out += "'";
        i++;
      } else return [out, i + 1];
    } else if (c === '"') {
      return [out, i + 1];
    } else if (c !== "\\") {
      out += c;
    } else {
      const e = text[++i];
      if (e === "\n") {
        // An escaped line break joins the lines without a space.
        while (text[i + 1] === " " || text[i + 1] === "\t") i++;
      } else if (e in HEX_ESCAPES) {
        const digits = text.slice(i + 1, i + 1 + HEX_ESCAPES[e]);
        if (digits.length !== HEX_ESCAPES[e] || !/^[0-9a-fA-F]+$/.test(digits))
          fail("bad escape in a double-quoted string");
        out += String.fromCodePoint(Number.parseInt(digits, 16));
        i += digits.length;
      } else if (e in ESCAPES) {
        out += ESCAPES[e];
      } else {
        fail("bad escape in a double-quoted string");
      }
    }
    i++;
  }
  return fail("a quoted string does not end");
}

/** The state of the comment scan, which a quoted value carries to the next line. */
function newScan() {
  return {
    quote: "",
    depth: 0,
    start: true,
    escape: false,
    cut: false,
    closedAt: -2,
  };
}

/**
 * Cut a comment (`#` at the start or after a space) that is not in quotes.
 * `scan` is the state at the start of the line, and it is the state at the end
 * of the line on return. A quote opens only where a value starts: at the start
 * of the text, after `- ` or `: `, and in a flow collection after `[`, `{`, or
 * `,`. `scan.escape` is true when the line ends in an escape `\` in a
 * double-quoted string, and `scan.cut` is true when a comment was cut.
 */
function stripComment(line, scan) {
  scan.escape = false;
  scan.closedAt = -2;
  // The end of the last escaped space or tab, which a trim must keep.
  let keep = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (scan.quote === '"') {
      if (c === "\\") {
        i++;
        scan.escape = i >= line.length;
        if (isSpace(line[i])) keep = i + 1;
      } else if (c === '"') {
        scan.quote = "";
        scan.start = false;
        scan.closedAt = i;
      }
    } else if (scan.quote === "'") {
      if (c === "'") {
        if (line[i + 1] === "'") i++;
        else {
          scan.quote = "";
          scan.start = false;
          scan.closedAt = i;
        }
      }
    } else if (isSpace(c)) {
      // A space does not change where a value starts.
    } else if (c === "#" && (i === 0 || " \t".includes(line[i - 1]))) {
      scan.cut = true;
      return trimEnd(line.slice(0, i), keep);
    } else if (scan.depth > 0 && (c === "[" || c === "{")) {
      scan.depth++;
      scan.start = true;
    } else if (scan.depth > 0 && (c === "]" || c === "}")) {
      scan.depth--;
      scan.start = false;
    } else if (scan.depth > 0 && c === ",") {
      scan.start = true;
    } else if (scan.start && (c === '"' || c === "'")) {
      scan.quote = c;
    } else if (scan.start && (c === "[" || c === "{")) {
      scan.depth = 1;
    } else if (
      scan.start &&
      (c === "-" || c === "?") &&
      (i + 1 >= line.length || isSpace(line[i + 1]))
    ) {
      // An indicator that a space follows: a value can still start.
    } else if (
      c === ":" &&
      (i + 1 >= line.length ||
        isSpace(line[i + 1]) ||
        (scan.depth > 0 && scan.closedAt === i - 1))
    ) {
      scan.start = true;
    } else {
      scan.start = false;
    }
  }
  return trimEnd(line, keep);
}

function resolvePlain(text) {
  if (text === "" || text === "~" || /^(null|Null|NULL)$/.test(text))
    return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (
    /^[-+]?[0-9]+$/.test(text) ||
    /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(text)
  )
    return Number(text);
  const radix = /^([-+]?)0(?:(x)[0-9a-fA-F]+|(o)[0-7]+)$/.exec(text);
  if (radix) {
    const digits = text.slice(radix[1].length + 2);
    const number = Number.parseInt(digits, radix[2] ? 16 : 8);
    return radix[1] === "-" ? -number : number;
  }
  if (/^[-+]?\.(inf|Inf|INF)$/.test(text))
    return text[0] === "-"
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  if (/^\.(nan|NaN|NAN)$/.test(text)) return Number.NaN;
  return text;
}

function checkStart(text) {
  if ("&*!@`%|>]}#".includes(text[0]) || /^[?:]([ \t]|$)/.test(text))
    fail(`"${text[0]}" is not in the supported YAML subset`);
}

/** Parse a flow sequence or flow map, and check that nothing follows it. */
function parseFlow(text) {
  let i = 0;
  let level = 0;
  // A blank line inside a flow collection is a line break in the text.
  const isBlank = (c) => isSpace(c) || c === "\n";
  const skip = () => {
    while (i < text.length && isBlank(text[i])) i++;
  };
  const plain = () => {
    const start = i;
    while (i < text.length && !",[]{}".includes(text[i])) {
      if (
        text[i] === ":" &&
        (i + 1 >= text.length || /[ \t\n,[\]{}]/.test(text[i + 1]))
      )
        break;
      i++;
    }
    let end = i;
    while (end > start && isBlank(text[end - 1])) end--;
    return text.slice(start, end);
  };
  // A quoted string, or null when the text at `i` is not quoted.
  const quoted = () => {
    skip();
    checkStart(text.slice(i, i + 2) || " ");
    if (text[i] !== '"' && text[i] !== "'") return null;
    const [str, end] = readQuoted(text, i);
    i = end;
    return str;
  };
  // A quoted or plain scalar. Returns its value and its text as a key.
  const scalar = () => {
    const str = quoted();
    if (str !== null) return [str, str];
    const raw = plain();
    if (raw === "") fail("an empty item in a flow collection");
    if (/^-([ \t]|$)/.test(raw)) fail("a block sequence is not allowed here");
    const resolved = resolvePlain(raw);
    return [resolved, String(resolved)];
  };
  const value = () => {
    skip();
    if (text[i] === "[") return collection("]", []);
    if (text[i] === "{") return collection("}", {});
    return scalar()[0];
  };
  // The value after a `:`. It can be empty.
  const after = (close, target, key) => {
    let item = null;
    if (text[i] === ":") {
      i++;
      skip();
      if (text[i] !== "," && text[i] !== close) item = value();
    }
    put(target, key, item);
  };
  const entry = (target, close) => {
    skip();
    if (close === "]") {
      // A `key: value` in a sequence is a map of one pair.
      if (text[i] === "[" || text[i] === "{") {
        target.push(value());
        return;
      }
      const [item, key] = scalar();
      skip();
      if (text[i] !== ":") {
        target.push(item);
        return;
      }
      const pair = {};
      after(close, pair, key);
      target.push(pair);
      return;
    }
    const [, key] = scalar();
    skip();
    after(close, target, key);
  };
  const collection = (close, target) => {
    if (++level > MAX_DEPTH) fail("flow collections are nested too deep");
    i++;
    for (;;) {
      skip();
      if (text[i] === close) break;
      entry(target, close);
      skip();
      if (text[i] === ",") i++;
      else if (text[i] !== close) fail("a flow collection is not valid");
    }
    i++;
    level--;
    return target;
  };
  const result = value();
  skip();
  if (i < text.length) fail("text after a flow collection");
  return result;
}

/** The value of a one-line or folded scalar, a quoted string, or a flow value. */
function parseScalar(text) {
  if (text[0] === "[" || text[0] === "{") return parseFlow(text);
  checkStart(text || " ");
  if (/^-([ \t]|$)/.test(text)) fail("a block sequence is not allowed here");
  if (text[0] === '"' || text[0] === "'") {
    const [str, end] = readQuoted(text, 0);
    if (trim(text.slice(end)) !== "") fail("text after a quoted string");
    return str;
  }
  if (/:([ \t]|$)/.test(text)) fail("a mapping value is not allowed here");
  return resolvePlain(text);
}

/** Split `key: rest` (the key can be quoted). Returns null for no key. */
function splitKey(text) {
  if (text[0] === '"' || text[0] === "'") {
    try {
      const [key, end] = readQuoted(text, 0);
      const colon = /^[ \t]*:(?:[ \t]+|$)/.exec(text.slice(end));
      return colon ? [key, trimStart(text.slice(end + colon[0].length))] : null;
    } catch {
      return null;
    }
  }
  if (text[0] === "[" || text[0] === "{") return null;
  const colon = /:(?:[ \t]|$)/.exec(text);
  if (!colon || colon.index === 0) return null;
  return [
    // A plain key resolves like a value, so `1.50` and `~` are the keys "1.5" and "null".
    String(resolvePlain(trimEnd(text.slice(0, colon.index)))),
    trimStart(text.slice(colon.index + 1)),
  ];
}

const isItem = (text) => text === "-" || text.startsWith("- ");

/**
 * The text of a block scalar whose lines start at `start`. `parent` is the
 * indent of the owner, and the content is indented more. `header` is the match
 * of BLOCK_HEADER. `open` is true when the last line has no line break. Returns
 * the text and the index of the first line after it.
 */
function blockScalar(lines, start, parent, header, open) {
  const folded = header[1] === ">";
  const sign = header[3] ?? header[4];
  const chomp = sign === "+" ? "keep" : sign === "-" ? "strip" : "clip";
  const explicit = header[2] ?? header[5];
  let end = start;
  let contentIndent = explicit ? Math.max(parent, 0) + Number(explicit) : -1;
  const body = [];
  let widest = 0;
  for (; end < lines.length; end++) {
    const line = lines[end];
    if (/^ *$/.test(line)) {
      if (contentIndent < 0) widest = Math.max(widest, line.length);
      // A blank line with more spaces than the indent has content.
      body.push(contentIndent >= 0 ? line.slice(contentIndent) : "");
      continue;
    }
    if (line[0] === "\t") {
      // A line of only tabs, or a tab and a comment, ends the scalar. A blank
      // line before the tabs is an error.
      const rest = trim(line);
      if (rest !== "" && rest[0] !== "#") fail("a tab can not indent a line");
      if (contentIndent < 0 || (rest === "" && body.at(-1) === ""))
        fail("a tab can not indent a line");
      break;
    }
    if (contentIndent < 0 && indentOf(line) > parent) {
      contentIndent = indentOf(line);
      if (widest > contentIndent)
        fail(
          "an empty line has more spaces than the first line of a block scalar",
        );
    }
    if (contentIndent < 0 || indentOf(line) < contentIndent) break;
    body.push(line.slice(contentIndent));
  }
  let trailing = 0;
  while (body.length > 0 && body[body.length - 1] === "") {
    body.pop();
    trailing++;
  }
  let text = "";
  if (!folded) {
    text = body.join("\n");
  } else {
    let previous = -1;
    let blanks = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "") {
        blanks++;
        continue;
      }
      if (previous < 0) {
        text = "\n".repeat(blanks) + body[i];
      } else {
        const spaced = /^[ \t]/.test(body[previous]) || /^[ \t]/.test(body[i]);
        const breaks = spaced ? blanks + 1 : blanks;
        text += (breaks === 0 ? " " : "\n".repeat(breaks)) + body[i];
      }
      previous = i;
      blanks = 0;
    }
  }
  // The last line has no line break: a blank last line adds no line break.
  if (open && end >= lines.length && body.length > 0 && trailing > 0)
    trailing--;
  if (chomp === "keep") text += "\n".repeat(trailing + (body.length ? 1 : 0));
  else if (chomp === "clip" && body.length > 0) text += "\n";
  return [text, end];
}

/**
 * Parse the YAML text. Returns null for an empty document. Throws an Error for
 * a syntax error and for input outside the supported subset.
 */
export function parseYaml(text) {
  const source = String(text).replace(/^﻿/, "");
  if (source.includes("\0")) fail("a NUL character is not allowed");
  const lines = source.split(/\r\n|\r|\n/);
  // The last line break ends the last line. It does not start an empty line.
  const open = lines[lines.length - 1] !== "" || lines.length === 1;
  if (!open) lines.pop();
  // The column where the content of a line starts, for a line that a dash has
  // moved. A line that has no entry starts at its own indent.
  const starts = new Map();
  const indent = (i) => starts.get(i) ?? indentOf(lines[i]);
  const newScanOf = (i) => {
    const scan = newScan();
    return [
      stripComment(trimStart(lines[i].slice(starts.get(i) ?? 0)), scan),
      scan,
    ];
  };
  const stripped = (i) => newScanOf(i)[0];
  let pos = 0;
  let depth = 0;

  const next = () => {
    while (pos < lines.length) {
      const trimmed = trim(lines[pos]);
      if (trimmed !== "" && trimmed[0] !== "#") {
        if (lines[pos][0] === "\t") fail("a tab can not indent a line");
        return pos;
      }
      pos++;
    }
    return -1;
  };

  // A value that starts on the line before `pos`, with its continuation lines.
  // `scan` is the state of the comment scan at the end of that line.
  const inline = (first, parent, scan) => {
    const header = BLOCK_HEADER.exec(first);
    if (header) {
      const [value, end] = blockScalar(lines, pos, parent, header, open);
      pos = end;
      return value;
    }
    let joined = first;
    for (;;) {
      let j = pos;
      let blanks = 0;
      let comments = false;
      while (j < lines.length) {
        const trimmed = trim(lines[j]);
        if (trimmed === "") blanks++;
        else if (trimmed[0] !== "#" || scan.quote) break;
        else comments = true;
        j++;
      }
      if (j >= lines.length) break;
      if (lines[j][0] === "\t") fail("a tab can not indent a line");
      if (indent(j) <= parent) {
        if (scan.depth === 0) break;
        // Only a `,` or a closing bracket, after a scalar, can stay at the
        // indent of the key.
        const after = trimStart(lines[j])[0];
        if (
          scan.quote ||
          scan.start ||
          "]}".includes(joined[joined.length - 1]) ||
          !",]}".includes(after)
        )
          fail("a flow collection continues at the indent of its key");
      }
      if (scan.depth === 0 && !scan.quote && (scan.cut || comments))
        fail("a comment is not allowed inside a plain scalar");
      // After an escaped line break the lines join with no space.
      const gap = scan.escape
        ? `\n${"\n".repeat(blanks)}`
        : blanks
          ? "\n".repeat(blanks)
          : " ";
      scan.cut = false;
      joined += gap + stripComment(trimStart(lines[j]), scan);
      pos = j + 1;
    }
    return parseScalar(joined);
  };

  const sequence = (column) => {
    const out = [];
    for (let i = next(); i >= 0 && indent(i) === column; i = next()) {
      const content = stripped(i);
      if (!isItem(content)) break;
      const rest = trimStart(content.slice(1));
      if (rest === "") {
        pos = i + 1;
        const j = next();
        out.push(j >= 0 && indent(j) > column ? node(column) : null);
      } else {
        // The item starts in the dash line: move the start of that line.
        starts.set(i, column + content.length - rest.length);
        out.push(node(column));
      }
    }
    return out;
  };

  const mapping = (column) => {
    const out = {};
    for (let i = next(); i >= 0 && indent(i) === column; i = next()) {
      const [content, scan] = newScanOf(i);
      if (isItem(content)) break;
      const pair = splitKey(content);
      if (!pair) fail(`line ${i + 1} is not a key`);
      checkStart(content);
      const [key, rest] = pair;
      pos = i + 1;
      if (rest !== "") {
        put(out, key, inline(rest, column, scan));
        continue;
      }
      const j = next();
      if (j >= 0 && indent(j) > column) put(out, key, node(column));
      else if (j >= 0 && indent(j) === column && isItem(stripped(j)))
        put(out, key, sequence(column));
      else put(out, key, null);
    }
    return out;
  };

  const node = (parent) => {
    if (++depth > MAX_DEPTH) fail("collections are nested too deep");
    const i = next();
    let result = null;
    if (i >= 0) {
      const [content, scan] = newScanOf(i);
      if (isItem(content)) {
        result = sequence(indent(i));
      } else if (splitKey(content)) {
        result = mapping(indent(i));
      } else {
        pos = i + 1;
        result = inline(content, parent, scan);
      }
    }
    depth--;
    return result;
  };

  const first = next();
  if (first >= 0 && stripped(first) === "---") pos = first + 1;
  const result = node(-1);
  const rest = next();
  if (rest >= 0) {
    if (/^(---|\.\.\.)([ \t]|$)/.test(lines[rest]))
      fail("more than one document is not supported");
    fail(`line ${rest + 1} is not valid here`);
  }
  return result;
}
