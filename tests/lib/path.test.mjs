// The pure path functions of dotclaude give the same results as `node:path`,
// except that `resolve` has no implicit current folder.

import { describe, expect, test } from "bun:test";
import nodePath from "node:path";
import { pathFor, posix, win32 } from "../../hooks/lib/_path.mjs";

const POSIX_PATHS = [
  "",
  ".",
  "..",
  "...",
  "./",
  "../",
  "/",
  "//",
  "///",
  "a",
  "a/",
  "a//",
  "a/b",
  "a/b/",
  "a//b",
  "a///b//c",
  "/a",
  "/a/",
  "//a",
  "//a/b",
  "/a/b/c",
  "/a/../b",
  "/a/./b",
  "/a/b/..",
  "/a/b/../..",
  "/a/b/../../..",
  "a/..",
  "a/../..",
  "../a",
  "../../a/b",
  "./a/./b/.",
  "a/b/../c/./d/",
  ".a",
  "/.a",
  ".a.",
  ".a.b",
  "a.b",
  "a.b.c",
  "a.",
  "/a/b.txt",
  "/a/b.tar.gz",
  "/a/.bashrc",
  "/a/b/.",
  "/a/b/..",
  "/a/..b",
  "/a/b..",
  "a.b/c",
  "a.b/",
  "/a.b/c.d/",
  "foo/bar.baz/",
  "x\\y",
  "a b/c d",
  "/a\\b/c",
  "~/a",
  "-a",
  "/a/b/c/d/e/f",
  "/usr/local/lib/node_modules",
  "/tmp/",
  "/tmp/x.js",
  "/..",
  "/../a",
  "/a/b//c//",
  "a/./.",
  "./.",
  "././a",
  "./..a",
  "/a/b.c/.",
  "//a//b//",
];

const WIN32_PATHS = [
  "",
  ".",
  "..",
  "...",
  ".\\",
  "..\\",
  "\\",
  "\\\\",
  "\\\\\\",
  "/",
  "//",
  "a",
  "a\\",
  "a\\\\",
  "a\\b",
  "a/b",
  "a\\b\\",
  "a/b/",
  "a\\/b\\\\c",
  "\\a",
  "/a",
  "\\a\\",
  "\\a\\b\\c",
  "\\a\\..\\b",
  "\\a\\.\\b",
  "\\a\\b\\..",
  "a\\..",
  "a\\..\\..",
  "..\\a",
  "..\\..\\a\\b",
  ".\\a\\.\\b\\.",
  "C:",
  "C:\\",
  "C:/",
  "C:a",
  "C:a\\b",
  "C:\\a",
  "c:/a",
  "c:/a/b/",
  "C:\\a\\..",
  "C:\\..",
  "C:..",
  "C:..\\a",
  "C:.\\a",
  "C:\\a\\b.txt",
  "C:\\a\\.git",
  "C:\\a\\b.tar.gz",
  "C:a.txt",
  "C:.a",
  "C:a:b",
  "a:b",
  "a:",
  "a:\\b",
  ".\\a:\\b",
  "1:\\a",
  "\\\\server",
  "\\\\server\\",
  "\\\\server\\share",
  "\\\\server\\share\\",
  "\\\\server\\share\\x",
  "\\\\server\\share\\x\\y.txt",
  "//server/share/x",
  "\\\\server\\share\\..\\x",
  "\\\\server\\share\\x\\..\\..",
  "\\\\\\server",
  "\\\\server\\\\share\\x",
  "\\\\.\\C:\\a",
  "\\\\?\\C:\\a",
  "\\\\?\\UNC\\s\\h\\x",
  "\\\\s.com\\sh.x",
  "\\\\a.b",
  "a.b\\c",
  ".a",
  "a.",
  "a..",
  "a.b.c",
  "\\a\\.b.c",
  "C:\\a/b\\c/d",
  "C:/a\\b/",
  "X:\\x\\y\\z\\",
  "a b\\c d",
  "C:\\a b\\",
];

// Absolute inputs, for `resolve`, `relative`, and `toNamespacedPath`.
const POSIX_ABS = [
  "/",
  "//",
  "/a",
  "/a/",
  "/a/b",
  "/a/b/c",
  "/a/b/../c",
  "/a/./b",
  "/a/b/..",
  "/ab",
  "/abc",
  "/a/bc",
  "/a/b/c/d",
  "/b",
  "/a//b",
  "/x/y/z",
  "/..",
  "/../a",
  "/a/b.txt",
  "/tmp/x",
  "/usr/local",
  "/usr/lib",
];

const WIN32_ABS = [
  "C:\\",
  "C:\\a",
  "C:\\a\\",
  "C:\\a\\b",
  "c:/a/b",
  "C:\\A\\B",
  "C:\\a\\b\\c",
  "C:\\a\\..\\b",
  "C:\\ab",
  "C:\\abc",
  "C:\\a\\bc",
  "D:\\",
  "D:\\a",
  "d:\\a\\b",
  "C:/",
  "C:\\a\\b\\c\\d",
  "\\\\server\\share",
  "\\\\server\\share\\",
  "\\\\server\\share\\x",
  "\\\\server\\share\\x\\y",
  "\\\\SERVER\\Share\\x",
  "\\\\server\\other\\x",
  "\\\\other\\share\\x",
  "//server/share/x",
  "\\\\s\\h\\a\\b",
  "\\\\?\\C:\\a",
  "\\\\.\\C:\\a",
  "\\\\?\\UNC\\s\\h\\x",
  // A UNC server that looks like a drive, and a share that is a prefix of
  // another. They reach the `relative` branches for a root of two characters.
  "\\\\s\\h",
  "\\\\s\\ha",
  "\\\\C:x\\y",
  "\\\\C:\\x",
];

const EXTS = ["", ".js", "js", ".txt", ".tar.gz", "b", ".b", "a.b", "x"];

// A small seeded generator. It uses all 32 bits, so the fuzz inputs repeat
// rarely. "\x" and "d:a" depend on the cwd in Node, so the rooted fuzz inputs
// always start with a drive or a UNC share.
function mulberry32(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLATFORMS = [
  ["posix", posix, nodePath.posix, POSIX_PATHS, POSIX_ABS],
  ["win32", win32, nodePath.win32, WIN32_PATHS, WIN32_ABS],
];

test("each table has at least 60 inputs", () => {
  expect(POSIX_PATHS.length).toBeGreaterThanOrEqual(60);
  expect(WIN32_PATHS.length).toBeGreaterThanOrEqual(60);
});

test("pathFor returns the two platform objects and rejects others", () => {
  expect(pathFor("posix")).toBe(posix);
  expect(pathFor("win32")).toBe(win32);
  expect(() => pathFor("darwin")).toThrow(TypeError);
});

for (const [name, ours, node, paths, abs] of PLATFORMS) {
  describe(name, () => {
    test("sep and delimiter", () => {
      expect(ours.sep).toBe(node.sep);
      expect(ours.delimiter).toBe(node.delimiter);
    });

    for (const fn of [
      "normalize",
      "isAbsolute",
      "dirname",
      "basename",
      "extname",
      "parse",
    ]) {
      test(fn, () => {
        for (const p of paths)
          expect([p, ours[fn](p)]).toEqual([p, node[fn](p)]);
      });
    }

    test("basename with ext", () => {
      for (const p of paths)
        for (const ext of EXTS)
          expect([p, ext, ours.basename(p, ext)]).toEqual([
            p,
            ext,
            node.basename(p, ext),
          ]);
    });

    test("join", () => {
      for (const p of paths)
        expect([p, ours.join(p)]).toEqual([p, node.join(p)]);
      expect(ours.join()).toBe(node.join());
      for (const a of paths)
        for (const b of paths.filter((_, i) => i % 7 === 0))
          expect([a, b, ours.join(a, b)]).toEqual([a, b, node.join(a, b)]);
      expect(ours.join("a", "", "b", "..", "c")).toBe(
        node.join("a", "", "b", "..", "c"),
      );
    });

    test("format", () => {
      const objects = [
        {},
        { base: "a.b" },
        { name: "a", ext: ".b" },
        { name: "a", ext: "b" },
        { root: "/", base: "a" },
        { root: "/", dir: "/x", base: "a" },
        { dir: "x", name: "a" },
        { root: "C:\\", dir: "C:\\x", name: "a", ext: ".b" },
        { root: "\\\\s\\h\\", base: "a" },
        ...paths.map((p) => node.parse(p)),
      ];
      for (const o of objects)
        expect([o, ours.format(o)]).toEqual([o, node.format(o)]);
      expect(() => ours.format(null)).toThrow(TypeError);
    });

    test("toNamespacedPath", () => {
      for (const p of ["", ...abs]) {
        expect([p, ours.toNamespacedPath(p)]).toEqual([
          p,
          node.toNamespacedPath(p),
        ]);
      }
    });

    test("relative", () => {
      for (const from of abs)
        for (const to of abs)
          expect([from, to, ours.relative(from, to)]).toEqual([
            from,
            to,
            node.relative(from, to),
          ]);
    });

    test("resolve with an absolute first segment", () => {
      for (const a of abs) {
        expect([a, ours.resolve(a)]).toEqual([a, node.resolve(a)]);
        for (const rel of ["", ".", "..", "x", "x/y", "../x", "..\\x", "./x/"])
          expect([a, rel, ours.resolve(a, rel)]).toEqual([
            a,
            rel,
            node.resolve(a, rel),
          ]);
      }
      for (const a of abs)
        for (const b of abs.filter((_, i) => i % 3 === 0))
          expect([a, b, ours.resolve(a, b)]).toEqual([
            a,
            b,
            node.resolve(a, b),
          ]);
    });

    test("resolve throws when no segment gives an absolute base", () => {
      for (const args of [[], [""], ["a"], ["a", "b"], [".", ".."]])
        expect(() => ours.resolve(...args)).toThrow(/absolute base/);
    });

    test("fuzz against node:path", () => {
      const parts =
        name === "posix"
          ? ["/", "/", "a", "b", ".", "..", ".x", "x.y", "", ":"]
          : ["\\", "/", "a", "b", ".", "..", ".x", "C:", "d:", "\\\\", ":"];
      // A rooted input gets a prefix that needs no current folder in Node,
      // then a tail with "." and ".." segments, mixed separators, and case.
      const prefixes =
        name === "posix"
          ? ["/", "/", "//"]
          : [
              "C:\\",
              "c:/",
              "D:\\",
              "\\\\s\\h",
              "\\\\S\\H\\",
              "//s/h/",
              "\\\\s\\ha",
              "\\\\C:x\\y",
              "\\\\C:\\x",
              "\\\\?\\C:\\",
              "\\\\.\\C:\\",
            ];
      const tails =
        name === "posix"
          ? ["/", "/", "a", "b", "A", ".", "..", "ab", "//"]
          : ["\\", "/", "a", "A", "b", "B", ".", "..", "ab", "AB", "\\\\"];
      const rand = mulberry32(12345);
      const next = (n) => Math.floor(rand() * n);
      const pick = (list) => list[next(list.length)];
      const make = () =>
        Array.from({ length: 1 + next(7) }, () => pick(parts)).join("");
      const makeRooted = () =>
        pick(prefixes) +
        Array.from({ length: next(6) }, () => pick(tails)).join("");
      const count = { relative: 0, resolve: 0, toNamespacedPath: 0 };
      const seen = { relative: new Set(), resolve: new Set() };
      for (let i = 0; i < 3000; i++) {
        const p = make();
        const q = make();
        for (const fn of [
          "normalize",
          "isAbsolute",
          "dirname",
          "basename",
          "extname",
          "parse",
        ])
          expect([fn, p, ours[fn](p)]).toEqual([fn, p, node[fn](p)]);
        expect([p, q, ours.basename(p, q)]).toEqual([
          p,
          q,
          node.basename(p, q),
        ]);
        expect([p, q, ours.join(p, q)]).toEqual([p, q, node.join(p, q)]);
        const root = name === "posix" ? "/r" : "C:\\r";
        if (name === "posix" || !otherDrive(p))
          expect([p, ours.resolve(root, p)]).toEqual([
            p,
            node.resolve(root, p),
          ]);
        const rp = makeRooted();
        const rq = makeRooted();
        expect([rp, rq, ours.relative(rp, rq)]).toEqual([
          rp,
          rq,
          node.relative(rp, rq),
        ]);
        count.relative++;
        seen.relative.add(`${rp}\0${rq}`);
        expect([rp, ours.toNamespacedPath(rp)]).toEqual([
          rp,
          node.toNamespacedPath(rp),
        ]);
        count.toNamespacedPath++;
        // A second segment that is a drive-relative path needs the cwd.
        const tail = name === "posix" || !drive(q) ? q : rq;
        expect([rp, tail, ours.resolve(rp, tail)]).toEqual([
          rp,
          tail,
          node.resolve(rp, tail),
        ]);
        count.resolve++;
        seen.resolve.add(`${rp}\0${tail}`);
      }
      expect(count.relative).toBeGreaterThanOrEqual(1000);
      expect(count.resolve).toBeGreaterThanOrEqual(1000);
      expect(count.toNamespacedPath).toBeGreaterThanOrEqual(1000);
      expect(seen.relative.size).toBeGreaterThanOrEqual(1000);
      expect(seen.resolve.size).toBeGreaterThanOrEqual(1000);
    });
  });
}

// A drive-relative segment such as "d:a" depends on the cwd of Node when no
// earlier segment is absolute on that drive.
const drive = (p) => /^[A-Za-z]:/.test(p);
const otherDrive = (p) => drive(p) && !/^c:/i.test(p);

test("win32 resolve of a drive-relative segment uses the drive root", () => {
  expect(win32.resolve("D:x")).toBe("D:\\x");
  expect(win32.resolve("D:")).toBe("D:\\");
  expect(win32.resolve("D:x\\y", "..")).toBe("D:\\x");
  expect(win32.resolve("C:\\a", "D:x")).toBe("D:\\x");
  expect(win32.resolve("D:x", "C:\\a")).toBe("C:\\a");
  expect(win32.resolve("D:\\a", "D:x")).toBe("D:\\a\\x");
});

test("win32 resolve checks every segment, as Bun does", () => {
  for (const args of [
    [5, "C:\\a"],
    [5, "y", "C:\\a"],
    ["C:\\a", 5],
    [null, "\\\\s\\h\\x"],
  ])
    expect(() => win32.resolve(...args)).toThrow(TypeError);
  // On posix, resolve stops at the first absolute segment.
  expect(posix.resolve(5, "/a")).toBe("/a");
  expect(() => posix.resolve("/a", 5)).toThrow(TypeError);
});

test("win32 resolve of a rooted path without a drive keeps no drive", () => {
  expect(win32.resolve("\\a")).toBe("\\a");
  expect(win32.resolve("x", "/a/../b")).toBe("\\b");
});

test("win32 join of three leading separators matches node:path", () => {
  for (const args of [
    ["\\\\\\server", "x"],
    ["\\\\\\", "\\\\\\x"],
    ["///a", "b"],
    ["\\\\", "\\a"],
    ["\\\\a", "b"],
  ])
    expect([args, win32.join(...args)]).toEqual([
      args,
      nodePath.win32.join(...args),
    ]);
});
