// Shell lexing for the guards: POSIX-style word splitting, heredoc bodies,
// and $(...)/backtick substitutions.

const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;

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

/** Remove heredoc bodies; return the remaining text and the bodies in order. */
export function extractHeredocs(command) {
  const lines = command.replace(/\\\n/g, " ").split("\n");
  const out = [];
  const bodies = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    i += 1;
    for (const match of line.matchAll(HEREDOC)) {
      const terminator = match[2];
      const body = [];
      while (i < lines.length && lines[i].trim() !== terminator) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the terminator line
      bodies.push(body.join("\n"));
    }
  }
  return { text: out.join("\n"), bodies };
}

/** Pull out $(...), <(...), >(...) and `...` bodies that sit outside single quotes. */
export function extractSubstitutions(text) {
  let out = "";
  const found = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    switch (ch) {
      case "'": {
        const end = text.indexOf("'", i + 1);
        if (end === -1) return { text: out + text.slice(i), found };
        out += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      case "\\":
        if (i + 1 >= text.length) break;
        out += text.slice(i, i + 2);
        i += 2;
        continue;
      case "$":
      case "<":
      case ">": {
        if (text[i + 1] !== "(" || text.startsWith("$((", i)) break;
        const end = closingParen(text, i + 2);
        found.push(text.slice(i + 2, end - 1));
        out += "__SUBST__";
        i = end;
        continue;
      }
      case "`": {
        const end = text.indexOf("`", i + 1);
        if (end === -1) return { text: out + text.slice(i), found };
        found.push(text.slice(i + 1, end));
        out += "__SUBST__";
        i = end + 1;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return { text: out, found };
}

/** Index just past the `)` that closes a group opened before `start`. */
function closingParen(text, start) {
  let depth = 1;
  let j = start;
  while (j < text.length && depth) {
    switch (text[j]) {
      case "(":
        depth += 1;
        break;
      case ")":
        depth -= 1;
        break;
    }
    j += 1;
  }
  return j;
}

/** POSIX-style word splitting with quotes, escapes, operators and comments. Throws on unterminated quotes. */
export function tokenize(text) {
  const tokens = [];
  let word = null;
  let i = 0;
  const pushWord = () => {
    if (word !== null) tokens.push(word);
    word = null;
  };
  while (i < text.length) {
    const ch = text[i];
    switch (ch) {
      case " ":
      case "\t":
        pushWord();
        i += 1;
        continue;
      case "#":
        if (word !== null) break; // `#` inside a word is literal
        while (i < text.length && text[i] !== "\n") i += 1;
        continue;
      case "'": {
        const end = text.indexOf("'", i + 1);
        if (end === -1) throw new Error("unterminated single quote");
        word = (word ?? "") + text.slice(i + 1, end);
        i = end + 1;
        continue;
      }
      case '"': {
        const { value, end } = doubleQuoted(text, i + 1);
        word = (word ?? "") + value;
        i = end + 1;
        continue;
      }
      case "\\":
        word = (word ?? "") + (text[i + 1] ?? "");
        i += 2;
        continue;
    }
    const op = OPERATORS.find((candidate) => text.startsWith(candidate, i));
    if (op) {
      pushWord();
      tokens.push({ op });
      i += op.length;
    } else {
      word = (word ?? "") + ch;
      i += 1;
    }
  }
  pushWord();
  return tokens;
}

/** Contents of a double-quoted string starting at `start`, and the index of its closing quote. */
function doubleQuoted(text, start) {
  let j = start;
  let value = "";
  while (j < text.length && text[j] !== '"') {
    if (
      text[j] === "\\" &&
      j + 1 < text.length &&
      '$`"\\\n'.includes(text[j + 1])
    ) {
      value += text[j + 1];
      j += 2;
    } else {
      value += text[j];
      j += 1;
    }
  }
  if (j >= text.length) throw new Error("unterminated double quote");
  return { value, end: j };
}
