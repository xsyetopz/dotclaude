// A pure parser for the block-style YAML subset that dotclaude reads: the
// frontmatter of skill, agent, rule, and output-style files, and the `hosts.yml`
// of the GitHub CLI. It imports nothing, so it also runs in a hooks module that
// has no Node and no Bun. It gives the same value as `Bun.YAML.parse` for the
// subset, and throws an Error for input outside it (anchors, aliases, tags,
// complex keys, and more than one document).

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
  _: " ",
  L: " ",
  P: " ",
};
const HEX_ESCAPES = { x: 2, u: 4, U: 8 };

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

/** Cut a comment (`#` at the start or after a space) that is not in quotes. */
function stripComment(line) {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const before = line[i - 1];
    if (quote === '"') {
      if (c === "\\") i++;
      else if (c === '"') quote = "";
    } else if (quote === "'") {
      if (c === "'") {
        if (line[i + 1] === "'") i++;
        else quote = "";
      }
    } else if (
      (c === '"' || c === "'") &&
      (i === 0 || " \t[{,".includes(before))
    ) {
      quote = c;
    } else if (c === "#" && (i === 0 || before === " " || before === "\t")) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function resolvePlain(text) {
  if (text === "" || text === "~" || /^(null|Null|NULL)$/.test(text))
    return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (
    /^[-+]?[0-9]+$/.test(text) ||
    /^0[xo][0-9a-fA-F]+$/.test(text) ||
    /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(text)
  )
    return Number(text);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(text))
    return text[0] === "-"
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  if (/^\.(nan|NaN|NAN)$/.test(text)) return Number.NaN;
  return text;
}

function checkStart(text) {
  if ("&*!@`%".includes(text[0]) || /^[?:](\s|$)/.test(text))
    fail(`"${text[0]}" is not in the supported YAML subset`);
}

/** Parse a flow sequence or flow map, and check that nothing follows it. */
function parseFlow(text) {
  let i = 0;
  const skip = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const plain = () => {
    const start = i;
    while (i < text.length && !",[]{}".includes(text[i])) {
      if (
        text[i] === ":" &&
        (i + 1 >= text.length || /[\s,[\]{}]/.test(text[i + 1]))
      )
        break;
      i++;
    }
    return text.slice(start, i).trim();
  };
  // A quoted string, or null when the text at `i` is not quoted.
  const quoted = () => {
    skip();
    checkStart(text.slice(i) || " ");
    if (text[i] !== '"' && text[i] !== "'") return null;
    const [str, end] = readQuoted(text, i);
    i = end;
    return str;
  };
  const value = () => {
    skip();
    if (text[i] === "[") return collection("]", []);
    if (text[i] === "{") return collection("}", {});
    const str = quoted();
    if (str !== null) return str;
    const raw = plain();
    if (raw === "") fail("an empty item in a flow collection");
    return resolvePlain(raw);
  };
  const entry = (target) => {
    if (Array.isArray(target)) {
      target.push(value());
      return;
    }
    const key = quoted() ?? plain();
    if (key === "") fail("an empty key in a flow map");
    skip();
    let item = null;
    if (text[i] === ":") {
      i++;
      skip();
      if (text[i] !== "," && text[i] !== "}") item = value();
    }
    put(target, key, item);
  };
  const collection = (close, target) => {
    i++;
    for (;;) {
      skip();
      if (text[i] === close) break;
      entry(target);
      skip();
      if (text[i] === ",") i++;
      else if (text[i] !== close) fail("a flow collection is not valid");
    }
    i++;
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
  if (text[0] === '"' || text[0] === "'") {
    const [str, end] = readQuoted(text, 0);
    if (text.slice(end).trim() !== "") fail("text after a quoted string");
    return str;
  }
  if (/:(\s|$)/.test(text)) fail("a mapping value is not allowed here");
  return resolvePlain(text);
}

/** Split `key: rest` (the key can be quoted). Returns null for no key. */
function splitKey(text) {
  if (text[0] === '"' || text[0] === "'") {
    try {
      const [key, end] = readQuoted(text, 0);
      const colon = /^[ \t]*:(?:[ \t]+|$)/.exec(text.slice(end));
      return colon ? [key, text.slice(end + colon[0].length).trim()] : null;
    } catch {
      return null;
    }
  }
  if (text[0] === "[" || text[0] === "{") return null;
  const colon = /:(?:[ \t]|$)/.exec(text);
  if (!colon || colon.index === 0) return null;
  return [
    text.slice(0, colon.index).trimEnd(),
    text.slice(colon.index + 1).trim(),
  ];
}

// True when a flow collection that starts in `text` has no closing bracket yet.
function flowOpen(text) {
  if (text[0] !== "[" && text[0] !== "{") return false;
  const bare = text.replace(/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'/g, "");
  return (
    (bare.match(/[[{]/g) ?? []).length > (bare.match(/[\]}]/g) ?? []).length
  );
}

const isItem = (text) => text === "-" || text.startsWith("- ");

/**
 * The text of a block scalar whose lines start at `start`. `parent` is the
 * indent of the owner, and the content is indented more. `header` is the match
 * of BLOCK_HEADER. Returns the text and the index of the first line after it.
 */
function blockScalar(lines, start, parent, header) {
  const folded = header[1] === ">";
  const sign = header[3] ?? header[4];
  const chomp = sign === "+" ? "keep" : sign === "-" ? "strip" : "clip";
  const explicit = header[2] ?? header[5];
  const indentOf = (line) => line.length - line.trimStart().length;
  let end = start;
  let contentIndent = explicit ? Math.max(parent, 0) + Number(explicit) : -1;
  const body = [];
  for (; end < lines.length; end++) {
    const line = lines[end];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (contentIndent < 0 && indentOf(line) > parent)
      contentIndent = indentOf(line);
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
  if (chomp === "keep") text += "\n".repeat(trailing + (body.length ? 1 : 0));
  else if (chomp === "clip" && body.length > 0) text += "\n";
  return [text, end];
}

/**
 * Parse the YAML text. Returns null for an empty document. Throws an Error for
 * a syntax error and for input outside the supported subset.
 */
export function parseYaml(text) {
  const lines = String(text)
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/);
  const indentOf = (i) => lines[i].length - lines[i].trimStart().length;
  const stripped = (i) => stripComment(lines[i].trim());
  let pos = 0;

  const next = () => {
    while (pos < lines.length) {
      const trimmed = lines[pos].trim();
      if (trimmed !== "" && trimmed[0] !== "#") return pos;
      pos++;
    }
    return -1;
  };

  // A value that starts on the line before `pos`, with its continuation lines.
  const inline = (first, parent) => {
    const header = BLOCK_HEADER.exec(first);
    if (header) {
      const [value, end] = blockScalar(lines, pos, parent, header);
      pos = end;
      return value;
    }
    let joined = first;
    for (;;) {
      let j = pos;
      let blanks = 0;
      while (j < lines.length) {
        const trimmed = lines[j].trim();
        if (trimmed === "") blanks++;
        else if (trimmed[0] !== "#") break;
        j++;
      }
      if (j >= lines.length || (indentOf(j) <= parent && !flowOpen(joined)))
        break;
      joined += (blanks ? "\n".repeat(blanks) : " ") + stripped(j);
      pos = j + 1;
    }
    return parseScalar(joined);
  };

  const sequence = (indent) => {
    const out = [];
    for (let i = next(); i >= 0 && indentOf(i) === indent; i = next()) {
      const content = stripped(i);
      if (!isItem(content)) break;
      const rest = content.slice(1).trimStart();
      if (rest === "") {
        pos = i + 1;
        const j = next();
        out.push(j >= 0 && indentOf(j) > indent ? node(indent) : null);
      } else {
        // The item starts in the dash line: treat the rest as its own line.
        lines[i] = " ".repeat(indent + content.length - rest.length) + rest;
        out.push(node(indent));
      }
    }
    return out;
  };

  const mapping = (indent) => {
    const out = {};
    for (let i = next(); i >= 0 && indentOf(i) === indent; i = next()) {
      const content = stripped(i);
      if (isItem(content)) break;
      const pair = splitKey(content);
      if (!pair) fail(`line ${i + 1} is not a key`);
      const [key, rest] = pair;
      pos = i + 1;
      if (rest !== "") {
        put(out, key, inline(rest, indent));
        continue;
      }
      const j = next();
      if (j >= 0 && indentOf(j) > indent) put(out, key, node(indent));
      else if (j >= 0 && indentOf(j) === indent && isItem(stripped(j)))
        put(out, key, sequence(indent));
      else put(out, key, null);
    }
    return out;
  };

  const node = (parent) => {
    const i = next();
    if (i < 0) return null;
    const content = stripped(i);
    if (isItem(content)) return sequence(indentOf(i));
    if (splitKey(content)) return mapping(indentOf(i));
    pos = i + 1;
    return inline(content, parent);
  };

  const first = next();
  if (first >= 0 && stripped(first) === "---") pos = first + 1;
  const result = node(-1);
  const rest = next();
  if (rest >= 0) {
    if (/^(---|\.\.\.)(\s|$)/.test(lines[rest]))
      fail("more than one document is not supported");
    fail(`line ${rest + 1} is not valid here`);
  }
  return result;
}
