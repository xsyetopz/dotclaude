// The pure glob in hooks/lib/_glob.mjs against `Bun.Glob#match` and
// `fs.globSync`, which the guards use today.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileGlob, globFiles, globMatch } from "../../hooks/lib/_glob.mjs";

// [pattern, paths that the pattern is tried on].
const TABLE = [
  ["*", ["", "a", ".a", "a/b", ".a/b"]],
  ["**", ["", "a", ".a/b", "a/b/c", "a/"]],
  ["*.js", ["a.js", ".x.js", "a/b.js", "a.jsx", ".js"]],
  [".*", [".a", "a", ".", ".a/b"]],
  ["a?c", ["abc", "a.c", "a/c", "ac", "abbc"]],
  ["?", ["a", ".", "/", "ab", ""]],
  ["??", ["ab", "a/", "a"]],
  ["a/*", ["a/b", "a/.b", "a/b/c", "a", "a/"]],
  ["*/*", ["a/b", "a/.b", "a", "a/b/c"]],
  ["**/x", ["x", "a/x", "a/.b/x", "a/b/c/x", "a/y", "xx"]],
  ["**/*", ["a", "a/b", "a/b/c", ".a/b"]],
  ["**/*.js", ["a.js", "a/b.js", "a/b/c.js", "a/b.ts", ".a/b.js"]],
  ["a/**", ["a", "a/", "a/b", "a/b/c", "b/a"]],
  ["a/**/b", ["a/b", "a/x/b", "a/x/y/b", "a/xb", "b"]],
  ["a**b", ["axxb", "ab", "ax/b", "a/b"]],
  ["a**", ["ax", "a", "ax/b"]],
  ["**a", ["xa", "x/a", "a"]],
  ["a/**b", ["a/xb", "a/b", "a/x/b"]],
  ["**/", ["a/", "a", "a/b/"]],
  ["**/a/**", ["a/b", "x/a/b", "x/a", "a"]],
  ["[abc]", ["a", "b", "d", "ab", ""]],
  ["[a-z]", ["m", "A", "-", "z"]],
  ["[a-c]x", ["bx", "dx", "b"]],
  ["[!x]", ["a", "x", "!"]],
  ["[^x]", ["a", "x", "^"]],
  ["[!a-c]", ["d", "b", "a"]],
  ["[]]", ["]", "a"]],
  ["[]a]", ["]", "a", "b"]],
  ["[a-]", ["-", "a", "b"]],
  ["[-a]", ["-", "a"]],
  ["[\\]]", ["]", "\\"]],
  ["[z-a]", ["m", "a", "z"]],
  ["[[:alpha:]]", ["a", "[", "a]"]],
  ["[.]x", [".x", "ax"]],
  ["file[0-9].txt", ["file1.txt", "filea.txt", "file10.txt"]],
  ["{a,b}", ["a", "b", "c", "a,b", ""]],
  ["{a}", ["a", "{a}"]],
  ["{}", ["", "a"]],
  ["{a,}", ["", "a", "b"]],
  ["{a,{b,c}}", ["a", "b", "c", "d"]],
  ["{a,{b,{c,d}}}x", ["dx", "ax", "x"]],
  ["a{b,c}d", ["abd", "acd", "ad", "abcd"]],
  ["{a/b,c}", ["a/b", "c", "a", "b"]],
  ["{a,b}/{c,d}", ["a/c", "b/d", "a/d", "c/a"]],
  ["{*,x}", ["a", "x", "a/b"]],
  ["{src,tests}/**", ["src/a.js", "tests/b/c.js", "docs/a", "src"]],
  ["*.{js,mjs}", ["a.js", "a.mjs", "a.ts", ".js"]],
  ["\\{a,b\\}", ["{a,b}", "a"]],
  ["{a,b", ["{a,b", "a"]],
  ["\\*", ["*", "a", "\\*"]],
  ["\\?", ["?", "a"]],
  ["\\[a]", ["[a]", "a"]],
  ["a\\/b", ["a/b", "ab"]],
  ["a\\*b", ["a*b", "axb"]],
  ["\\a", ["a", "\\a"]],
  ["a\\", ["a\\", "a"]],
  ["!a", ["a", "b", ""]],
  ["!*.js", ["a.js", "a.ts"]],
  ["!a/b", ["a", "b", "a/b"]],
  ["a", ["a", "a/", "b", "A"]],
  ["a/", ["a/", "a"]],
  ["/a", ["/a", "a"]],
  ["./a", ["a", "./a"]],
  ["a//b", ["a/b", "a//b"]],
  ["a/b/c", ["a/b/c", "a/b", "a/b/c/d"]],
  ["", ["", "a"]],
  ["@(a|b)", ["a", "@(a|b)"]],
  ["a+b", ["a+b", "aab"]],
  ["a.b", ["a.b", "axb"]],
  ["a(b)", ["a(b)", "ab"]],
  ["a$b^", ["a$b^"]],
  ["a|b", ["a|b", "a"]],
  // The `protected` globs of a loop and the `-name` filters of `find`.
  ["tests/**", ["tests/a.mjs", "tests/lib/b.mjs", "src/tests/a", "tests"]],
  ["tests/lib/*.test.mjs", ["tests/lib/a.test.mjs", "tests/lib/x/a.test.mjs"]],
  ["**/*.test.mjs", ["a.test.mjs", "tests/a.test.mjs", "a.mjs"]],
  [".dotclaude/loop/*", [".dotclaude/loop/loop.json", ".dotclaude/loop"]],
  ["justfile", ["justfile", "src/justfile"]],
  ["node_modules", ["node_modules", "a/node_modules"]],
  ["node_*", ["node_modules", "node", "nodes"]],
  ["*.log", ["a.log", ".log", "a.log.1"]],
  ["build*", ["build", "builds", "rebuild"]],
  ["[Dd]ist", ["dist", "Dist", "xdist"]],
  [".git", [".git", "git"]],
  ["???", ["abc", "ab", "abcd"]],
  ["*a*", ["a", "bab", "b", ""]],
  ["*a*b*", ["ab", "xaxbx", "ba"]],
  ["héllo*", ["héllo", "héllow", "hello"]],
  ["日本/*", ["日本/語", "日本"]],
];

test("globMatch gives the same answer as Bun.Glob#match", () => {
  let count = 0;
  for (const [pattern, paths] of TABLE) {
    const match = compileGlob(pattern);
    for (const p of paths) {
      count++;
      expect([pattern, p, match(p)]).toEqual([
        pattern,
        p,
        new Bun.Glob(pattern).match(p),
      ]);
      expect(globMatch(pattern, p)).toBe(match(p));
    }
  }
  expect(count).toBeGreaterThanOrEqual(80);
});

test("globMatch holds known answers", () => {
  expect(globMatch("*", ".a")).toBe(true);
  expect(globMatch("a/**/b", "a/b")).toBe(true);
  expect(globMatch("a/**", "a")).toBe(false);
  expect(globMatch("a**b", "ax/b")).toBe(false);
  expect(globMatch("{a,{b,c}}", "c")).toBe(true);
  expect(globMatch("\\*", "a")).toBe(false);
});

const io = {
  fs: {
    list: async (dir) => {
      const names = await fs.promises.readdir(dir);
      return Promise.all(
        names.map(async (name) => {
          const full = path.join(dir, name);
          const link = (await fs.promises.lstat(full)).isSymbolicLink();
          let st = null;
          try {
            st = await fs.promises.stat(full);
          } catch {}
          const kind = st?.isDirectory()
            ? "dir"
            : st?.isFile()
              ? "file"
              : "other";
          return {
            name,
            kind,
            size: st?.size ?? 0,
            mtimeMs: st?.mtimeMs ?? 0,
            isLink: link,
          };
        }),
      );
    },
  },
};

function tree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "glob-")));
  for (const f of [
    "a/x.js",
    "a/y.ts",
    "a/.h/y.js",
    "a/b/c/deep.js",
    "a/b/c/deep.ts",
    ".d/z",
    ".r",
    "b/q",
    "b/.hid",
    "c/x.js",
    "top.js",
    "ab/x.js",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), "");
  }
  fs.symlinkSync(path.join(root, "a"), path.join(root, "lnk"));
  fs.symlinkSync(path.join(root, "nowhere"), path.join(root, "dead"));
  return root;
}

const FILE_PATTERNS = [
  "*",
  "**",
  "*/*",
  // `**/*` is not here: `fs.globSync` also lists the first level inside a
  // linked folder for it, and globFiles does not.
  "**/*.js",
  ".*",
  "lnk/",
  "a/*",
  "a/**",
  "a/**/",
  "a/",
  "a",
  "nope",
  "nope/*",
  "nope*",
  "top.js",
  "a/x.js",
  "a/nope.js",
  "a/x.js/y",
  "lnk/*",
  "lnk/**",
  "lnk",
  "**/y.js",
  "**/.h",
  "**/.h/*",
  "a/.h/*",
  "a/*/c/*",
  "a/**/deep.*",
  "{a,b}/*",
  "{a,c}/**/*.js",
  "{a/x.js,top.js}",
  "[ab]/*",
  "[!a]*",
  "a?",
  "./a/*",
  "a/../b/*",
  "a/./x.js",
  "*/",
  "**/",
  "**/c/*",
  "*.{js,ts}",
  "**/*.{js,ts}",
  "**/x.js",
  "dead",
  "*/x.js",
  "a/b/**/*.ts",
];

test("globFiles gives the paths that fs.globSync gives, relative to cwd", async () => {
  const root = tree();
  try {
    for (const pattern of FILE_PATTERNS) {
      const want = fs.globSync(pattern, { cwd: root }).sort();
      const got = (await globFiles(io, pattern, { cwd: root })).sort();
      expect([pattern, got]).toEqual([pattern, want]);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("globFiles gives absolute paths for an absolute pattern", async () => {
  const root = tree();
  try {
    for (const rest of [
      "*",
      "a/*",
      "**/*.js",
      "{a,b}/*",
      "a/b/c/deep.js",
      "nope/*",
    ]) {
      const pattern = `${root}/${rest}`;
      const want = fs.globSync(pattern).sort();
      const got = (await globFiles(io, pattern)).sort();
      expect([pattern, got]).toEqual([pattern, want]);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("globFiles with dot matches a leading dot, with onlyFiles skips folders", async () => {
  const root = tree();
  try {
    const dotted = await globFiles(io, "*", { cwd: root, dot: true });
    expect(dotted).toContain(".d");
    expect(dotted).toContain(".r");
    const files = await globFiles(io, "**", {
      cwd: root,
      dot: true,
      onlyFiles: true,
    });
    expect(files).toContain("a/.h/y.js");
    expect(files).toContain("top.js");
    expect(files).not.toContain("a");
    expect(files).not.toContain(".");
    // Bun.Glob#scan with `dot` finds the same files.
    const scan = [
      ...new Bun.Glob("**/*.js").scanSync({ cwd: root, dot: true }),
    ];
    const ours = await globFiles(io, "**/*.js", {
      cwd: root,
      dot: true,
      onlyFiles: true,
    });
    expect(ours.filter((p) => !p.startsWith("lnk/")).sort()).toEqual(
      scan.filter((p) => !p.startsWith("lnk/")).sort(),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("globFiles lists only the folders that the pattern needs", async () => {
  const root = tree();
  try {
    const listed = [];
    const spy = {
      fs: {
        list: (dir) => {
          listed.push(path.relative(root, dir));
          return io.fs.list(dir);
        },
      },
    };
    await globFiles(spy, "a/b/c/*.js", { cwd: root });
    expect(listed).toEqual([path.join("a", "b", "c")]);
    listed.length = 0;
    await globFiles(spy, "*/x.js", { cwd: root });
    expect(listed.sort()).toEqual(["", "a", "ab", "b", "c"].sort());
    listed.length = 0;
    expect(await globFiles(spy, "nope/deeper/*", { cwd: root })).toEqual([]);
    expect(listed).toEqual([path.join("nope", "deeper")]);
    listed.length = 0;
    await globFiles(spy, "**/*.js", { cwd: root });
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).not.toContain(path.join("a", ".h"));
    expect(listed).not.toContain("lnk");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
