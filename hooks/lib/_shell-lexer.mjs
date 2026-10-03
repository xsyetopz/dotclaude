// Shell lexing for the guards: one quote-aware pass that splits words and
// operators, reads heredoc bodies, and collects $(...), <(...), >(...) and
// backtick substitutions.
// One pass keeps one quote model, so a quote that one step reads as text
// cannot hide a command from another step.

const OPERATORS = [
  "&>>",
  "<<<",
  "<<-",
  "&&",
  "||",
  "|&",
  ";;",
  ">>",
  "<<",
  ">&",
  "<&",
  "&>",
  ">|",
  "<>",
  ";",
  "&",
  "|",
  "(",
  ")",
  "<",
  ">",
  "\n",
];

const ANSI_C = {
  n: "\n",
  t: "\t",
  r: "\r",
  e: "\x1b",
  E: "\x1b",
  a: "\x07",
  b: "\b",
  f: "\f",
  v: "\v",
};

// `$'...'` escapes with a number: `\x72`, `r`, `\U00000072`.
// Octal `\162` and control `\cX` escapes are decoded in `ansiC`.
const ANSI_CODE = {
  x: { digits: /^[0-9A-Fa-f]{1,2}/, base: 16 },
  u: { digits: /^[0-9A-Fa-f]{1,4}/, base: 16 },
  U: { digits: /^[0-9A-Fa-f]{1,8}/, base: 16 },
};

// Operators after which the next word starts a command.
const COMMAND_START = new Set([
  ";",
  "\n",
  "&&",
  "||",
  "|",
  "|&",
  "&",
  ";;",
  "(",
  ")",
  "{",
  "}",
]);

// Reserved words after which the next word also starts a command.
const KEYWORDS = new Set([
  "if",
  "then",
  "do",
  "else",
  "elif",
  "while",
  "until",
  "!",
  "time",
]);

/**
 * Split `text` into tokens: a word is a string and an operator is `{op}`.
 * An unquoted `{` or `}` word where a command starts is an operator, and a
 * descriptor number that touches a redirect joins it (`2>`).
 * Inside `((...))`, `<<` is a shift and not a heredoc.
 * `heredocs` holds the bodies in the order of their `<<` operators, and
 * `substitutions` holds the command text of each substitution, also those in
 * unquoted heredoc bodies.
 * Throws on an unterminated quote, substitution, or backtick.
 * @returns {{tokens: (string|{op: string})[], heredocs: string[], substitutions: string[]}}
 */
export function lex(text) {
  const out = scan(text, 0, false);
  return {
    tokens: out.tokens,
    heredocs: out.heredocs,
    substitutions: out.substitutions,
  };
}

/** The tokens of `text`, as `lex` gives them. */
export function tokenize(text) {
  return lex(text).tokens;
}

/**
 * Scan from `start`.
 * When `nested` is true, the scan is the inside of a `$(` group, and it
 * stops after the `)` that closes it.
 */
function scan(text, start, nested) {
  const tokens = [];
  const heredocs = [];
  const substitutions = [];
  const pending = [];
  let word = null;
  let quoted = false;
  let depth = 0;
  // The paren depth inside an arithmetic `((...))`, or -1 outside it.
  let arith = -1;
  // Open `case` statements, whose patterns end with a `)` that does not
  // close a `$(` group.
  let cases = 0;
  let commandStart = true;
  let i = start;

  const add = (s, isQuoted = false) => {
    word = (word ?? "") + s;
    if (isQuoted) quoted = true;
  };
  const pushWord = () => {
    if (word === null) return;
    if (commandStart && !quoted && (word === "{" || word === "}")) {
      tokens.push({ op: word });
    } else {
      tokens.push(word);
      if (commandStart && !quoted && word === "case") cases += 1;
      if (commandStart && !quoted && word === "esac" && cases > 0) cases -= 1;
      commandStart = commandStart && !quoted && KEYWORDS.has(word);
    }
    word = null;
    quoted = false;
  };
  // A `$(...)` group whose text starts at `from`.
  const substitution = (from) => {
    const inner = scan(text, from, true);
    substitutions.push(text.slice(from, inner.end - 1));
    return inner.end;
  };

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "\\") {
      if (next === "\n") i += 2;
      else {
        add(next ?? "", true);
        i += 2;
      }
      continue;
    }
    if (ch === " " || ch === "\t") {
      pushWord();
      i += 1;
      continue;
    }
    if (ch === "#" && word === null) {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) throw new Error("unterminated single quote");
      add(text.slice(i + 1, end), true);
      i = end + 1;
      continue;
    }
    if (ch === "$" && next === "'") {
      const { value, end } = ansiC(text, i + 2);
      add(value, true);
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      const { value, end, found } = doubleQuoted(text, i + 1);
      substitutions.push(...found);
      add(value, true);
      i = end + 1;
      continue;
    }
    if (ch === "$" && next === "(") {
      if (text[i + 2] === "(") {
        // Arithmetic is text, but a substitution inside it still runs.
        const inner = scan(text, i + 2, true);
        substitutions.push(...inner.substitutions);
        add(text.slice(i, inner.end));
        i = inner.end;
      } else {
        i = substitution(i + 2);
        add("__SUBST__");
      }
      continue;
    }
    if ((ch === "<" || ch === ">") && next === "(") {
      i = substitution(i + 2);
      add("__SUBST__");
      continue;
    }
    if (ch === "`") {
      const { value, end } = backtick(text, i + 1);
      substitutions.push(value);
      add("__SUBST__");
      i = end + 1;
      continue;
    }
    const op = OPERATORS.find((candidate) => text.startsWith(candidate, i));
    if (!op) {
      add(ch);
      i += 1;
      continue;
    }
    i += op.length;
    // Push the word first, so that an `esac` before the `)` closes its `case`.
    if (op === ")") pushWord();
    if (op === ")" && nested && depth === 0 && cases === 0)
      return { tokens, heredocs, substitutions, end: i };
    if (op === "(") {
      if (arith < 0 && commandStart && word === null && text[i] === "(")
        arith = depth + 1;
      depth += 1;
    }
    if (op === ")" && depth > 0) {
      depth -= 1;
      if (depth < arith) arith = -1;
    }
    if (arith >= 0 && op.startsWith("<<")) {
      add(op);
      continue;
    }
    if (/^[<>]/.test(op) && word !== null && !quoted && /^\d+$/.test(word)) {
      tokens.push({ op: word + op });
      word = null;
    } else {
      pushWord();
      tokens.push({ op });
    }
    if (COMMAND_START.has(op)) commandStart = true;
    if (op === "<<" || op === "<<-") {
      const delim = delimiter(text, i);
      tokens.push(delim.word);
      pending.push(delim);
      i = delim.end;
    } else if (op === "\n" && pending.length) {
      for (const doc of pending.splice(0)) {
        const body = heredocBody(text, i, doc.word);
        heredocs.push(body.text);
        if (doc.expand) substitutions.push(...bodySubstitutions(body.text));
        i = body.end;
      }
    }
  }
  if (nested) throw new Error("unterminated substitution");
  pushWord();
  return { tokens, heredocs, substitutions, end: i };
}

/** The heredoc word after `<<` at `start`, and whether its body expands. */
function delimiter(text, start) {
  let i = start;
  while (text[i] === " " || text[i] === "\t") i += 1;
  let word = "";
  let expand = true;
  while (i < text.length && !/[\s;&|<>()]/.test(text[i])) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1);
      if (end === -1) throw new Error("unterminated heredoc word");
      word += text.slice(i + 1, end);
      expand = false;
      i = end + 1;
    } else if (ch === "\\") {
      word += text[i + 1] ?? "";
      expand = false;
      i += 2;
    } else {
      word += ch;
      i += 1;
    }
  }
  return { word, expand, end: i };
}

/** The body lines from `start` up to the `word` line, and the index after it. */
function heredocBody(text, start, word) {
  const lines = [];
  let i = start;
  while (i < text.length) {
    const nl = text.indexOf("\n", i);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(i, end);
    i = nl === -1 ? text.length : nl + 1;
    if (line.trim() === word) return { text: lines.join("\n"), end: i };
    lines.push(line);
  }
  return { text: lines.join("\n"), end: i };
}

/** Substitutions in an unquoted heredoc body, where quotes are text. */
function bodySubstitutions(body) {
  const found = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\") {
      i += 2;
    } else if (ch === "$" && body[i + 1] === "(" && body[i + 2] !== "(") {
      const inner = scan(body, i + 2, true);
      found.push(body.slice(i + 2, inner.end - 1));
      i = inner.end;
    } else if (ch === "`") {
      const { value, end } = backtick(body, i + 1);
      found.push(value);
      i = end + 1;
    } else {
      i += 1;
    }
  }
  return found;
}

/** A double-quoted string from `start`: its text, closing index, and substitutions. */
function doubleQuoted(text, start) {
  let j = start;
  let value = "";
  const found = [];
  while (j < text.length && text[j] !== '"') {
    const ch = text[j];
    if (ch === "\\" && j + 1 < text.length && '$`"\\\n'.includes(text[j + 1])) {
      if (text[j + 1] !== "\n") value += text[j + 1];
      j += 2;
    } else if (ch === "$" && text[j + 1] === "(") {
      const inner = scan(text, j + 2, true);
      if (text[j + 2] === "(") {
        found.push(...inner.substitutions);
        value += text.slice(j, inner.end);
      } else {
        found.push(text.slice(j + 2, inner.end - 1));
        value += "__SUBST__";
      }
      j = inner.end;
    } else if (ch === "`") {
      const tick = backtick(text, j + 1);
      found.push(tick.value);
      value += "__SUBST__";
      j = tick.end + 1;
    } else {
      value += ch;
      j += 1;
    }
  }
  if (j >= text.length) throw new Error("unterminated double quote");
  return { value, end: j, found };
}

/** A backtick body from `start`, with its escapes removed, and the closing index. */
function backtick(text, start) {
  let j = start;
  let value = "";
  while (j < text.length && text[j] !== "`") {
    if (text[j] === "\\" && "$`\\".includes(text[j + 1] ?? "")) {
      value += text[j + 1];
      j += 2;
    } else {
      value += text[j];
      j += 1;
    }
  }
  if (j >= text.length) throw new Error("unterminated backtick");
  return { value, end: j };
}

/** A `$'...'` string from `start`, with its escapes decoded, and the closing index. */
function ansiC(text, start) {
  let j = start;
  let value = "";
  while (j < text.length && text[j] !== "'") {
    if (text[j] === "\\" && j + 1 < text.length) {
      const e = text[j + 1];
      const code = ANSI_CODE[e] && text.slice(j + 2).match(ANSI_CODE[e].digits);
      if (code) {
        value += String.fromCodePoint(
          Number.parseInt(code[0], ANSI_CODE[e].base) % 0x110000,
        );
        j += 2 + code[0].length;
      } else if (/[0-7]/.test(e)) {
        const octal = text.slice(j + 1).match(/^[0-7]{1,3}/)[0];
        value += String.fromCharCode(Number.parseInt(octal, 8) & 0xff);
        j += 1 + octal.length;
      } else if (e === "c" && j + 2 < text.length) {
        value += String.fromCharCode(text.charCodeAt(j + 2) & 0x1f);
        j += 3;
      } else {
        value += ANSI_C[e] ?? (`'"\\?`.includes(e) ? e : `\\${e}`);
        j += 2;
      }
    } else {
      value += text[j];
      j += 1;
    }
  }
  if (j >= text.length) throw new Error("unterminated ANSI-C quote");
  return { value, end: j };
}
