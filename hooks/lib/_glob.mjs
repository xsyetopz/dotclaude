// Pure glob matching, with no import and no runtime global. A hooks module
// has no Node and no Bun, so the guards cannot use `Bun.Glob` or
// `fs.globSync`. `globMatch` follows `new Bun.Glob(pattern).match(path)` and
// `globFiles` follows `fs.globSync` (and `Bun.Glob#scan` with `dot`). A test
// compares both with the originals.
//
// Pattern features:
// - `*` is any run of characters in one segment. `?` is one character.
// - `**` as a whole segment is zero or more segments. In a longer segment it
//   is the same as `*`.
// - `[abc]`, `[a-z]`, `[!x]` and `[^x]` are character classes.
// - `{a,b}` is a set of alternatives. A set can hold sets, and an
//   alternative can hold `/`.
// - `\x` is the character `x`.
// - A leading `!` reverses the match.
// - `globMatch` has no dotfile rule, as `Bun.Glob#match`. `globFiles` skips
//   a name with a leading `.` unless the pattern names the dot or `dot` is
//   set, as `fs.globSync`.

const SPECIAL = /[\\^$.*+?()[\]{}|]/g;
const CLASS_SPECIAL = /[\\^\][-]/g;

function quote(text) {
  return text.replace(SPECIAL, "\\$&");
}

function quoteInClass(text) {
  return text.replace(CLASS_SPECIAL, "\\$&");
}

/**
 * The alternatives of a pattern with the `{a,b}` sets expanded, or null when
 * a set has no closing brace. An escaped brace stays in the text.
 */
function expandBraces(pattern) {
  let open = -1;
  let depth = 0;
  const commas = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
    } else if (c === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (c === "," && depth === 1) {
      commas.push(i);
    } else if (c === "}" && depth > 0 && --depth === 0) {
      const head = pattern.slice(0, open);
      const tail = pattern.slice(i + 1);
      const bounds = [open, ...commas, i];
      const out = [];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const part = pattern.slice(bounds[k] + 1, bounds[k + 1]);
        const rest = expandBraces(head + part + tail);
        if (!rest) return null;
        out.push(...rest);
      }
      return out;
    }
  }
  if (depth === 0) return [pattern];
  // A set with no closing brace gives its first alternative, as Bun does, and
  // a set with no comma gives nothing.
  if (!commas.length) return null;
  return expandBraces(pattern.slice(0, commas[0]).replace("{", ""));
}

/** The regex source of the class that starts at `text[start]`, with its end. */
function parseClass(text, start) {
  let i = start + 1;
  let negate = false;
  if (text[i] === "!" || text[i] === "^") {
    negate = true;
    i++;
  }
  const items = [];
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
      if (lo <= hi) items.push(`${quoteInClass(lo)}-${quoteInClass(hi)}`);
    } else {
      items.push(quoteInClass(lo));
    }
  }
  if (i >= text.length) return null;
  const set = items.join("");
  const source = negate ? `[^/${set}]` : set ? `[${set}]` : "(?!)";
  return { source, end: i };
}

// A segment that matches no name: a lone `\` or a class with no `]`.
const NEVER = { literal: null, dot: false, regex: /(?!)/u };

/**
 * One segment of a pattern: `{ globstar: true }` for `**`, otherwise
 * `{ source, literal, dot }`. `literal` is the exact name when the segment has
 * no wildcard. `dot` is true when the segment names a leading dot.
 */
function parseSegment(text) {
  if (text === "**") return { globstar: true };
  let source = "";
  let literal = "";
  let magic = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "*") {
      while (text[i] === "*") i++;
      source += "[^/]*";
      magic = true;
      continue;
    }
    if (c === "?") {
      source += "[^/]";
      magic = true;
    } else if (c === "[") {
      const cls = parseClass(text, i);
      if (cls) {
        source += cls.source;
        magic = true;
        i = cls.end + 1;
        continue;
      }
      return NEVER;
    } else if (c === "\\" && i + 1 >= text.length) {
      return NEVER;
    } else {
      const ch = c === "\\" && i + 1 < text.length ? text[++i] : c;
      source += quote(ch);
      literal += ch;
    }
    i++;
  }
  return {
    source,
    literal: magic ? null : literal,
    dot: text.startsWith(".") || text.startsWith("\\."),
    regex: new RegExp(`^${source}$`, "u"),
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

/** A matcher of the segment list `segs` for the segment list `names`. */
function segmentMatcher(segs) {
  return (names) => {
    const seen = new Set();
    const go = (i, j) => {
      const key = i * (names.length + 1) + j;
      if (seen.has(key)) return false;
      seen.add(key);
      if (i === segs.length) return j === names.length;
      const seg = segs[i];
      if (seg.globstar) {
        // A final `**` needs at least one segment, which can be empty.
        if (i === segs.length - 1) return j < names.length;
        for (let k = j; k <= names.length; k++) if (go(i + 1, k)) return true;
        return false;
      }
      return j < names.length && seg.regex.test(names[j]) && go(i + 1, j + 1);
    };
    return go(0, 0);
  };
}

/**
 * A function that tells if a path matches `pattern`. The path uses `/`, as in
 * `new Bun.Glob(pattern).match(path)`.
 */
export function compileGlob(pattern) {
  const negate = pattern.startsWith("!");
  const alternatives = expandBraces(negate ? pattern.slice(1) : pattern) ?? [];
  const matchers = alternatives.map((alt) =>
    segmentMatcher(splitSegments(alt).map(parseSegment)),
  );
  return (path) => {
    const names = path.split("/");
    return matchers.some((m) => m(names)) !== negate;
  };
}

/** True when `path` matches `pattern`. */
export function globMatch(pattern, path) {
  return compileGlob(pattern)(path);
}

/** The path `name` in the folder `rel`. */
function join(rel, name) {
  if (rel === "") return name;
  return rel === "/" ? `/${name}` : `${rel}/${name}`;
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

/**
 * The paths that match `pattern`, found with `io.fs.list(dir)` (which gives
 * `[{ name, kind, size, mtimeMs, isLink }]` and rejects for a missing folder).
 * An absolute pattern gives absolute paths. A relative pattern starts in
 * `cwd` and gives paths relative to it. A trailing `/` keeps only folders.
 * The list is in walk order, with the entries of a folder sorted by name. The
 * walk does not enter a folder that the pattern cannot reach: a literal
 * segment costs no listing, `**` does not enter a link or a dot folder, and
 * each folder is listed once.
 *
 * Options: `cwd` (default `.`), `dot` (a wildcard also matches a leading
 * dot) and `onlyFiles` (skip folders, as `Bun.Glob#scan`).
 */
export async function globFiles(
  io,
  pattern,
  { cwd = ".", dot = false, onlyFiles = false } = {},
) {
  const dirsOnly = pattern.length > 1 && pattern.endsWith("/");
  const absolute = pattern.startsWith("/");
  const listed = new Map();
  const ls = (rel) => {
    const dir = absolute ? rel || "/" : rel ? `${cwd}/${rel}` : cwd;
    if (!listed.has(dir)) {
      listed.set(
        dir,
        Promise.resolve()
          .then(() => io.fs.list(dir))
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
  const emit = (rel, e, named = false) => {
    if (dirsOnly && !(e.kind === "dir" && !e.isLink) && !(named && e.isLink))
      return;
    if (onlyFiles && e.kind !== "file") return;
    found.add(rel);
  };
  const visible = (name, seg) => dot || seg?.dot || !name.startsWith(".");
  let visited = new Set();

  const walk = async (rel, segs, i) => {
    const mark = `${rel}\0${i}`;
    if (visited.has(mark)) return;
    visited.add(mark);
    const seg = segs[i];
    const last = i === segs.length - 1;
    if (seg.literal !== null && !seg.globstar) {
      if (!last) return walk(join(rel, seg.literal), segs, i + 1);
      const e = (await ls(rel))?.find((x) => x.name === seg.literal);
      if (e) emit(join(rel, e.name), e, true);
      return;
    }
    const entries = await ls(rel);
    if (!entries) return;
    if (seg.globstar) {
      if (!last) await walk(rel, segs, i + 1);
      else if (!onlyFiles) found.add(rel || ".");
      for (const e of entries) {
        if (!visible(e.name, null)) continue;
        const child = join(rel, e.name);
        if (last) emit(child, e);
        if (e.kind === "dir" && !e.isLink) await walk(child, segs, i);
      }
      return;
    }
    for (const e of entries) {
      if (!visible(e.name, seg) || !seg.regex.test(e.name)) continue;
      if (last) emit(join(rel, e.name), e);
      else if (e.kind === "dir" && !e.isLink)
        await walk(join(rel, e.name), segs, i + 1);
    }
  };

  const alternatives = expandBraces(pattern) ?? [];
  for (const alt of alternatives) {
    const segs = walkSegments(alt);
    visited = new Set();
    if (segs.length) await walk(absolute ? "/" : "", segs, 0);
  }
  return [...found];
}
