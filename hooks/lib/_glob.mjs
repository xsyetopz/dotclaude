// Pure glob matching, with no import and no runtime global. A hooks module
// has no Node and no Bun, so the guards cannot use `Bun.Glob` or
// `fs.globSync`. `globMatch` follows `new Bun.Glob(pattern).match(path)` and
// `globFiles` follows `fs.globSync` (and `Bun.Glob#scan` with `dot`). A test
// compares both with the originals.
//
// Pattern features:
// - `*` is any run of characters in one segment. `?` is one character.
// - `**` as a whole segment is zero or more segments. In a longer segment it
//   is the same as `*`, and so is a lone `**` in a `{a,b}` set.
// - `[abc]`, `[a-z]`, `[!x]` and `[^x]` are character classes.
// - `{a,b}` is a set of alternatives. A set can hold sets, and an
//   alternative can hold `/`. A brace in a class is a plain character. A
//   pattern with more than 1024 alternatives matches nothing.
// - `\x` is the character `x`.
// - A leading `!` reverses the match. Each more `!` reverses it again.
// - `globMatch` has no dotfile rule, as `Bun.Glob#match`. `globFiles` skips
//   a name with a leading `.` unless the pattern names the dot or `dot` is
//   set, as `fs.globSync`.
//
// Known differences from `Bun.Glob#match` and `fs.globSync`:
// - A class that holds `/`, as `[/]` or `[!/]`, matches nothing. Bun matches
//   `/` with `[/]`. The match works on one segment at a time.
// - `****/**` on `a` does not match, and `**/*` on an empty path does.
//   Bun gives the reverse.
// - Some odd forms of an unclosed set or an empty set can give another
//   result than Bun gives.
// - `\n` matches `n`. Bun gives no match for a `\` before some letters.
// - A `[` with no `]` matches nothing. `fs.globSync` reads it as a plain `[`.
// - `globFiles` for `**/*` does not list the first level in a linked folder.
// - A pattern with more than 1024 alternatives, or more than 4096 set
//   expansions, matches nothing.
// - On win32 the match is case sensitive.
// - `globFiles` starts a relative pattern in `cwd`, which is `.` by default.
//   It is not `io.cwd`, so a caller must pass `cwd: io.cwd`.

// The most alternatives that the `{a,b}` sets of one pattern can give.
const MAX_ALTERNATIVES = 1024;
// The most set expansions of one pattern. A set with one alternative, as
// `{a}`, gives no new alternative, so this bound is apart from the one above.
const MAX_EXPANSIONS = 4 * MAX_ALTERNATIVES;

/**
 * The alternatives of a pattern with the `{a,b}` sets expanded, or null when
 * a set has no closing brace and no comma, the pattern has more than
 * `MAX_ALTERNATIVES` alternatives, or it needs more than `MAX_EXPANSIONS`
 * expansions. An escaped brace and a brace in a class stay in the text. The
 * work list is a stack and not a recursion, so a long run of sets cannot
 * overflow the call stack. Each scan goes on from the set that it just
 * expanded and skips a `[` after one that has no `]`.
 */
function expandBraces(pattern) {
  const out = [];
  const todo = [{ text: pattern, from: 0 }];
  let expansions = 0;
  while (todo.length) {
    const { text, from } = todo.pop();
    if (++expansions > MAX_EXPANSIONS) return null;
    let open = -1;
    let close = -1;
    let depth = 0;
    // A `[` with no `]` shows that a later `[` has none, as it is later.
    let openClass = false;
    const commas = [];
    for (let i = from; i < text.length && close < 0; i++) {
      const c = text[i];
      if (c === "\\") {
        i++;
      } else if (c === "[" && !openClass) {
        const cls = parseClass(text, i);
        if (cls) i = cls.end;
        else openClass = true;
      } else if (c === "{") {
        if (depth === 0) open = i;
        depth++;
      } else if (c === "," && depth === 1) {
        commas.push(i);
      } else if (c === "}" && depth > 0 && --depth === 0) {
        close = i;
      }
    }
    if (close >= 0) {
      const head = text.slice(0, open);
      const tail = text.slice(close + 1);
      const bounds = [open, ...commas, close];
      // The last alternative goes in first, so the first one comes out first.
      for (let k = bounds.length - 2; k >= 0; k--) {
        let part = text.slice(bounds[k] + 1, bounds[k + 1]);
        // Bun reads a lone `**` in a set as `*`, not as a globstar.
        if (part === "**") part = "*";
        todo.push({ text: head + part + tail, from: open });
      }
    } else if (depth === 0) {
      if (out.push(text) > MAX_ALTERNATIVES) return null;
    } else if (commas.length) {
      // A set with no closing brace gives its first alternative, as Bun does.
      todo.push({
        text: text.slice(0, commas[0]).replace("{", ""),
        from: 0,
      });
    } else {
      // A set with no closing brace and no comma gives nothing.
      return null;
    }
  }
  return out;
}

/**
 * The class token that starts at `text[start]`, with the index of its `]`, or
 * null when the class has no `]`. `text` is a string or an array of
 * characters.
 */
function parseClass(text, start) {
  let i = start + 1;
  let negate = false;
  if (text[i] === "!" || text[i] === "^") {
    negate = true;
    i++;
  }
  const ranges = [];
  let first = true;
  while (i < text.length && (text[i] !== "]" || first)) {
    first = false;
    let lo = text[i];
    if (lo === "\\" && i + 1 < text.length) lo = text[++i];
    i++;
    if (text[i] === "-" && i + 1 < text.length && text[i + 1] !== "]") {
      let hi = text[i + 1];
      i += 2;
      if (hi === "\\" && i < text.length) hi = text[i++];
      // A range that runs backward matches nothing.
      if (lo <= hi) ranges.push([lo.codePointAt(0), hi.codePointAt(0)]);
    } else {
      ranges.push([lo.codePointAt(0), lo.codePointAt(0)]);
    }
  }
  if (i >= text.length) return null;
  return { token: { kind: "class", negate, ranges }, end: i };
}

/** True when the token `tok` matches the character `ch`. */
function tokenMatches(tok, ch) {
  if (tok.kind === "any") return true;
  if (tok.kind === "char") return tok.ch === ch;
  const code = ch.codePointAt(0);
  const hit = tok.ranges.some(([lo, hi]) => code >= lo && code <= hi);
  return hit !== tok.negate;
}

/**
 * True when the whole list `items` matches the token list `toks`. A token
 * with `star` matches zero or more items. The walk keeps only the last star
 * and goes back to it, so the time is at most the product of the two lengths
 * and a hostile pattern cannot make it grow faster.
 */
function wildMatch(toks, items, matches) {
  let t = 0;
  let n = 0;
  let starT = -1;
  let starN = 0;
  while (n < items.length) {
    if (t < toks.length && toks[t].star) {
      starT = t++;
      starN = n;
    } else if (t < toks.length && matches(toks[t], items[n])) {
      t++;
      n++;
    } else if (starT >= 0) {
      t = starT + 1;
      n = ++starN;
    } else {
      return false;
    }
  }
  while (t < toks.length && toks[t].star) t++;
  return t === toks.length;
}

// A segment that matches no name: a lone `\` or a class with no `]`.
const NEVER = { literal: null, dot: false, test: () => false };

/**
 * One segment of a pattern: `{ globstar: true }` for `**`, otherwise
 * `{ test, literal, dot }`. `test(name)` tells if a name matches. `literal` is
 * the exact name when the segment has no wildcard. `dot` is true when the
 * segment names a leading dot.
 */
function parseSegment(text) {
  if (text === "**") return { globstar: true };
  const chars = [...text];
  const toks = [];
  let literal = "";
  let magic = false;
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === "*") {
      while (chars[i] === "*") i++;
      toks.push({ star: true });
      magic = true;
      continue;
    }
    if (c === "?") {
      toks.push({ kind: "any" });
      magic = true;
    } else if (c === "[") {
      const cls = parseClass(chars, i);
      if (!cls) return NEVER;
      toks.push(cls.token);
      magic = true;
      i = cls.end + 1;
      continue;
    } else if (c === "\\" && i + 1 >= chars.length) {
      return NEVER;
    } else {
      const ch = c === "\\" ? chars[++i] : c;
      toks.push({ kind: "char", ch });
      literal += ch;
    }
    i++;
  }
  return {
    literal: magic ? null : literal,
    dot: text.startsWith(".") || text.startsWith("\\."),
    test: (name) => wildMatch(toks, [...name], tokenMatches),
  };
}

/** The segments of an alternative, split at each `/` that is not escaped. */
function splitSegments(text) {
  const parts = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "/") {
      parts.push(current);
      current = "";
      i++;
    } else if (text[i] === "\\" && i + 1 < text.length) {
      current += text[i] + text[++i];
    } else if (text[i] === "/") {
      parts.push(current);
      current = "";
    } else {
      current += text[i];
    }
  }
  parts.push(current);
  return parts;
}

/** The tokens of a segment list: `**` is a star, and a last `**` needs one. */
function segmentTokens(segs) {
  const toks = [];
  segs.forEach((seg, i) => {
    if (!seg.globstar) toks.push({ seg });
    else if (i === segs.length - 1) toks.push({ any: true }, { star: true });
    else toks.push({ star: true });
  });
  return toks;
}

const segmentMatches = (tok, name) => tok.any || tok.seg.test(name);

/**
 * A function that tells if a path matches `pattern`. The path uses `/`, as in
 * `new Bun.Glob(pattern).match(path)`. A pattern with more than 1024
 * alternatives after the `{a,b}` sets are expanded matches nothing. The parse
 * is linear in the pattern length for each alternative, and a match takes at
 * most the product of the pattern length and the path length.
 */
export function compileGlob(pattern) {
  // Each leading `!` reverses the match again, as in Bun.
  let bangs = 0;
  while (pattern[bangs] === "!") bangs++;
  const negate = bangs % 2 === 1;
  const alternatives = expandBraces(pattern.slice(bangs)) ?? [];
  const matchers = alternatives.map((alt) =>
    segmentTokens(splitSegments(alt).map(parseSegment)),
  );
  return (path) => {
    const names = path.split("/");
    return matchers.some((m) => wildMatch(m, names, segmentMatches)) !== negate;
  };
}

/** True when `path` matches `pattern`. */
export function globMatch(pattern, path) {
  return compileGlob(pattern)(path);
}

/** The path `name` in the folder `rel`. */
function join(rel, name) {
  return rel === "" ? name : `${rel}/${name}`;
}

/**
 * The segments of one alternative for a walk: `.` and empty segments are
 * gone, and a literal segment cancels the literal segment before it when it
 * is `..`. Null for an empty list.
 */
function walkSegments(alt) {
  const segs = [];
  for (const text of splitSegments(alt)) {
    if (text === "" || text === ".") continue;
    const seg = parseSegment(text);
    const last = segs[segs.length - 1];
    if (seg.literal === ".." && last?.literal && last.literal !== "..")
      segs.pop();
    else segs.push(seg);
  }
  return segs;
}

// The root of an absolute pattern on Windows: a drive (`C:/`) or a UNC share
// (`//server/share/`). The pattern has `/` for every `\`.
const WIN_ROOT = /^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+\/?)/;

/**
 * The paths that match `pattern`, found with `io.fs.list(dir)` (which gives
 * `[{ name, kind, isLink }]` and rejects for a missing folder).
 * A link has `kind: "other"` and `isLink: true`. An absolute pattern gives
 * absolute paths. A relative pattern starts in `cwd` and gives paths relative
 * to it. A trailing `/` keeps only folders. The list is in walk order, with
 * the entries of a folder sorted by name. The walk does not enter a folder
 * that the pattern cannot reach: a literal segment costs no listing, `**`
 * does not enter a link or a dot folder, and each folder is listed once.
 *
 * When `io.platform` is `"win32"`, `\` is a separator and not an escape, a
 * drive root (`C:\`, `C:/`) and a UNC root (`\\server\share\`) are absolute,
 * and the paths have `\`, as `fs.globSync` gives on Windows.
 *
 * Options: `cwd` (default `.`), `dot` (a wildcard also matches a leading
 * dot) and `onlyFiles` (default false, skip folders). The default lists
 * folders too, as `fs.globSync`. `Bun.Glob#scan` gives only files by default,
 * so a call site that replaces it must pass `onlyFiles: true`.
 *
 * Known difference from `fs.globSync`: for `**\/*` it also lists the first
 * level inside a linked folder, and `globFiles` does not. A pattern with more
 * than 1024 alternatives after the `{a,b}` sets are expanded gives no path.
 */
export async function globFiles(
  io,
  pattern,
  { cwd = ".", dot = false, onlyFiles = false } = {},
) {
  const win = io.platform === "win32";
  const text = win ? pattern.replaceAll("\\", "/") : pattern;
  const dirsOnly = text.length > 1 && text.endsWith("/");
  const listed = new Map();
  const ls = (root, rel) => {
    const dir = root === null ? (rel ? `${cwd}/${rel}` : cwd) : root + rel;
    if (!listed.has(dir)) {
      listed.set(
        dir,
        Promise.resolve()
          .then(() => io.fs.list(win ? dir.replaceAll("/", "\\") : dir))
          .then(
            (entries) =>
              [...entries].sort((a, b) =>
                a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
              ),
            () => null,
          ),
      );
    }
    return listed.get(dir);
  };
  const found = new Set();
  // A trailing `/` keeps a folder. A name in the pattern also keeps a link,
  // but a wildcard does not, as in `fs.globSync`.
  const emit = (path, e, named = false) => {
    if (dirsOnly && !(e.kind === "dir" && !e.isLink) && !(named && e.isLink))
      return;
    if (onlyFiles && e.kind !== "file") return;
    found.add(path);
  };
  const visible = (name, seg) => dot || seg?.dot || !name.startsWith(".");
  let visited = new Set();

  // `root` is null for a relative pattern, otherwise the root with a `/`.
  // `rel` is the folder under the root or `cwd`.
  const walk = async (root, rel, segs, i) => {
    const mark = `${rel}\0${i}`;
    if (visited.has(mark)) return;
    visited.add(mark);
    const seg = segs[i];
    const last = i === segs.length - 1;
    const out = (name) => (root ?? "") + join(rel, name);
    if (seg.literal !== null && !seg.globstar) {
      if (!last) return walk(root, join(rel, seg.literal), segs, i + 1);
      const e = (await ls(root, rel))?.find((x) => x.name === seg.literal);
      if (e) emit(out(e.name), e, true);
      return;
    }
    const entries = await ls(root, rel);
    if (!entries) return;
    if (seg.globstar) {
      if (!last) await walk(root, rel, segs, i + 1);
      else if (!onlyFiles)
        found.add(rel === "" ? (root ?? ".") : (root ?? "") + rel);
      for (const e of entries) {
        if (!visible(e.name, null)) continue;
        if (last) emit(out(e.name), e);
        if (e.kind === "dir" && !e.isLink)
          await walk(root, join(rel, e.name), segs, i);
      }
      return;
    }
    for (const e of entries) {
      if (!visible(e.name, seg) || !seg.test(e.name)) continue;
      if (last) emit(out(e.name), e);
      else if (e.kind === "dir" && !e.isLink)
        await walk(root, join(rel, e.name), segs, i + 1);
    }
  };

  const alternatives = expandBraces(text) ?? [];
  for (const alt of alternatives) {
    let root = null;
    let body = alt;
    if (win) {
      root = WIN_ROOT.exec(alt)?.[0] ?? null;
      if (root !== null) {
        body = alt.slice(root.length);
        if (!root.endsWith("/")) root += "/";
      }
    }
    if (root === null && alt.startsWith("/")) root = "/";
    const segs = walkSegments(body);
    visited = new Set();
    if (segs.length) await walk(root, "", segs, 0);
  }
  const all = [...found];
  return win ? all.map((p) => p.replaceAll("/", "\\")) : all;
}
